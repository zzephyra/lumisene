"""Bounded local FFmpeg execution. All inputs are private staged files, never URLs."""

import asyncio
import json
from pathlib import Path


async def command(*args: str, timeout: int = 600) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        # Do not expose subprocess diagnostics or private filesystem paths to clients.
        raise ValueError("Media processing failed")
    return stdout


def frame_filter(
    width: int,
    height: int,
    fps: int,
    start: int,
    end: int,
    frame: str = "fit",
) -> str:
    """Fit keeps the whole frame and pads. Fill covers the chosen canvas."""
    base = f"fps={fps},trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS,"
    if frame == "fill":
        return (
            base + f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1"
        )
    return (
        base + f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )


async def probe(path: Path) -> dict:
    data = json.loads(
        await command(
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mov,matroska,webm",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
            timeout=30,
        )
    )
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    if not video:
        raise ValueError("Source contains no video")
    duration = float(video.get("duration") or data["format"].get("duration", 0))
    if not 0 < duration <= 600:
        raise ValueError("Video duration must be between 0 and 600 seconds")
    return {
        "frames": int(duration * 30 + 0.001),
        "duration_ms": round(duration * 1000),
        "width": video["width"],
        "height": video["height"],
        "audio": any(s["codec_type"] == "audio" for s in data["streams"]),
    }


async def render(composition: dict, inputs: dict[str, Path], directory: Path) -> Path:
    """Render segments separately to bound decoder concurrency, then concatenate."""
    width, height, fps = composition["width"], composition["height"], composition["fps"]
    clips = sorted(composition["tracks"][0]["clips"], key=lambda c: c["timeline_start_frame"])
    metadata = {key: await probe(path) for key, path in inputs.items()}
    segments: list[Path] = []
    position = 0

    async def segment(frames: int, clip: dict | None) -> None:
        target = directory / f"segment-{len(segments)}.mp4"
        duration = frames / fps
        args = [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-threads",
            "2",
            "-filter_complex_threads",
            "1",
        ]
        if clip is None:
            args += [
                "-f",
                "lavfi",
                "-i",
                f"color=c=black:s={width}x{height}:r={fps}",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-map",
                "0:v",
                "-map",
                "1:a",
            ]
        else:
            info = metadata[clip["asset_id"]]
            if (
                clip["source_end_frame"] > info["frames"]
                or clip["original_duration"] != info["frames"]
            ):
                raise ValueError("Source frame range is invalid")
            args += [
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,matroska,webm",
                "-i",
                str(inputs[clip["asset_id"]]),
            ]
            if not info["audio"]:
                args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            start, end = clip["source_start_frame"], clip["source_end_frame"]
            vf = frame_filter(
                width,
                height,
                fps,
                start,
                end,
                composition.get("frame", "fit"),
            )
            audio_source = "0:a" if info["audio"] else "1:a"
            audio_trim = f"atrim=start={start / fps}:end={end / fps}," if info["audio"] else ""
            volume = 0 if clip["muted"] else clip["volume"]
            af = (
                f"{audio_trim}asetpts=PTS-STARTPTS,aresample=48000,"
                f"aformat=channel_layouts=stereo,volume={volume},apad,atrim=duration={duration}"
            )
            args += [
                "-filter_complex",
                f"[0:v]{vf}[v];[{audio_source}]{af}[a]",
                "-map",
                "[v]",
                "-map",
                "[a]",
            ]
        args += [
            "-t",
            str(duration),
            "-r",
            str(fps),
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(target),
        ]
        await command(*args)
        segments.append(target)

    for clip in clips:
        if clip["timeline_start_frame"] > position:
            await segment(clip["timeline_start_frame"] - position, None)
        await segment(clip["duration"], clip)
        position = clip["timeline_start_frame"] + clip["duration"]
    if position < composition["duration_in_frames"]:
        await segment(composition["duration_in_frames"] - position, None)
    listing = directory / "segments.txt"
    listing.write_text("".join(f"file '{path.name}'\n" for path in segments))
    output = directory / "output.mp4"
    await command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        str(listing),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(output),
    )
    return output
