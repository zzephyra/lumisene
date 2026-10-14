import { useId, useRef, useState, type ReactNode } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Film } from "lucide-react";
import "./video-player.css";

function timestamp(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Media playback only; callers supply project-specific actions through the toolbar. */
export function VideoPlayer({ src, actions, prompt }: { src: string; actions?: ReactNode; prompt?: string }) {
  const tooltipId = useId();
  const [showPrompt, setShowPrompt] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  async function toggle() {
    if (!video.current) return;
    if (!video.current.paused) video.current.pause();
    else {
      try { await video.current.play(); setError(""); }
      catch { setError("无法播放视频，请检查连接后重试"); }
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch { setError("当前浏览器暂不支持全屏播放"); }
  }
  return <div className="lumi-player" ref={container}>
    {prompt?.trim() && <div className="lumi-player-prompt"
      onMouseEnter={() => setShowPrompt(true)} onMouseLeave={() => setShowPrompt(false)}
      onFocus={() => setShowPrompt(true)} onBlur={() => setShowPrompt(false)}
      onKeyDown={event => { if (event.key === "Escape") setShowPrompt(false); }}>
      <span className="lumi-player-prompt-label">提示词</span>
      <span className="lumi-player-prompt-text" tabIndex={0} aria-describedby={showPrompt ? tooltipId : undefined}>{prompt}</span>
      {showPrompt && <div className="lumi-player-prompt-tooltip" id={tooltipId} role="tooltip">{prompt}</div>}
    </div>}
    <div className="lumi-player-stage">
      <video ref={video} src={src} playsInline preload="metadata" aria-label="视频预览"
        onClick={() => void toggle()}
        onLoadedMetadata={() => setDuration(Number.isFinite(video.current!.duration) ? video.current!.duration : 0)}
        onTimeUpdate={() => setTime(video.current!.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onVolumeChange={() => { setMuted(video.current!.muted); setVolume(video.current!.volume); }}
        onError={() => setError("视频加载失败，请刷新后重试")} />
      {!playing && !error && <button type="button" className="lumi-player-play" aria-label="播放视频" onClick={() => void toggle()}><Play size={26} fill="currentColor" /></button>}
      {error && <div className="lumi-player-error" role="alert">{error}</div>}
    </div>
    <div className="lumi-player-controls">
      <input aria-label="播放进度" type="range" min={0} max={duration || 1} step={0.01} value={time} disabled={!duration} onChange={event => { const value = Number(event.target.value); if (video.current) video.current.currentTime = value; setTime(value); }} />
      <div className="lumi-player-control-row">
        <button type="button" aria-label={playing ? "暂停" : "播放"} onClick={() => void toggle()}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <span className="lumi-player-time">{timestamp(time)} <span>/ {timestamp(duration)}</span></span>
        <div className="lumi-player-spacer" />
        <button type="button" aria-label={muted ? "取消静音" : "静音"} onClick={() => { if (video.current) video.current.muted = !video.current.muted; }}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <input className="lumi-player-volume" aria-label="音量" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={event => { if (video.current) { video.current.volume = Number(event.target.value); video.current.muted = false; } }} />
        <select aria-label="播放速度" value={speed} onChange={event => { const value = Number(event.target.value); if (video.current) video.current.playbackRate = value; setSpeed(value); }}>{[0.5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select>
        <button type="button" aria-label="切换全屏" onClick={() => void fullscreen()}><Maximize size={18} /></button>
      </div>
    </div>
    <div className="lumi-player-toolbar"><span><Film size={16} /> 视频作品</span><div className="lumi-player-actions">{actions}</div></div>
  </div>;
}
