import { useEffect, useState } from "react";
import { thumbnail } from "./media";
import type { ClipData } from "./api";
import { mediaUrl } from "./api";
export function Thumbnail({ url, frame }: { url: string; frame: number }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSrc(undefined);
    setFailed(false);
    thumbnail(url, frame, controller.signal)
      .then((image) => {
        if (!controller.signal.aborted) setSrc(image);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [url, frame]);
  return src ? (
    <img alt="" src={src} draggable={false} />
  ) : (
    <span className="ve-thumb-placeholder">{failed ? "预览不可用" : "…"}</span>
  );
}
export function ThumbnailStrip({
  clip,
  projectId,
  scale,
  viewLeft,
  viewWidth,
}: {
  clip: ClipData;
  projectId: string;
  scale: number;
  viewLeft: number;
  viewWidth: number;
}) {
  const width = clip.duration * scale;
  const first = Math.max(
    0,
    Math.floor((viewLeft - clip.timeline_start_frame * scale) / 96) - 1,
  );
  const last = Math.min(
    Math.ceil(width / 96),
    Math.ceil((viewLeft + viewWidth - clip.timeline_start_frame * scale) / 96) +
      1,
  );
  return (
    <div className="ve-thumbnails">
      {Array.from(
        { length: Math.max(0, last - first) },
        (_, i) => first + i,
      ).map((i) => (
        <span
          key={i}
          style={{ left: i * 96, width: Math.min(96, width - i * 96) }}
        >
          <Thumbnail
            url={mediaUrl(projectId, clip.asset_id)}
            frame={Math.min(
              clip.source_end_frame - 1,
              clip.source_start_frame + Math.floor((i * 96) / scale),
            )}
          />
        </span>
      ))}
    </div>
  );
}
