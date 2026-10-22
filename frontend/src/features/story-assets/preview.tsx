import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { VideoPlayer } from "../../components/media/video-player";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { resourceText, type LibraryAsset } from "./api";

export function AssetPreview({
  projectId,
  storyId,
  items,
  index,
  onIndex,
  onClose,
  onDetail,
}: {
  projectId: string;
  storyId: string;
  items: LibraryAsset[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onDetail: (item: LibraryAsset) => void;
}) {
  const item = items[index];
  const [zoom, setZoom] = useState(false);
  const [touch, setTouch] = useState<number | null>(null);
  useEffect(() => setZoom(false), [item?.id]);
  if (!item) return null;
  const textQuery = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "resources", item.source, item.id, "text"],
    queryFn: ({ signal }) => resourceText(projectId, storyId, item, signal),
    enabled: item.mime === "text/plain" || item.mime === "text/markdown",
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="story-asset-stage" aria-describedby={undefined}>
        <DialogTitle className="truncate pr-10">{item.name}</DialogTitle>
        <DialogDescription className="sr-only">资源预览</DialogDescription>
        <div
          className="story-asset-preview"
          onTouchStart={(event) => setTouch(event.changedTouches[0]?.clientX ?? null)}
          onTouchEnd={(event) => {
            if (touch == null) return;
            const delta = (event.changedTouches[0]?.clientX ?? touch) - touch;
            if (delta > 40) onIndex(Math.max(0, index - 1));
            if (delta < -40) onIndex(Math.min(items.length - 1, index + 1));
            setTouch(null);
          }}
        >
          {item.kind === "image" && (
            <img alt={item.name} data-zoom={zoom} src={item.preview_url} />
          )}
          {item.kind === "video" && <VideoPlayer src={item.preview_url} />}
          {item.kind === "document" && item.mime !== "text/plain" && item.mime !== "text/markdown" && (
            <div className="grid justify-items-center gap-3 text-sm text-muted">
              <p>这个格式不在页面里预览。</p>
              <a className="underline" href={item.preview_url} rel="noreferrer" target="_blank">
                下载 {item.filename}
              </a>
            </div>
          )}
          {(item.mime === "text/plain" || item.mime === "text/markdown") && (
            <pre>{textQuery.isError ? "无法预览，请下载原文件。" : textQuery.data ?? "正在读取文本…"}</pre>
          )}
        </div>
        <div className="story-asset-preview-bar">
          <div className="flex gap-2">
            <Button variant="outline" disabled={index === 0} onClick={() => onIndex(index - 1)}>
              上一张
            </Button>
            <Button variant="outline" disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)}>
              下一张
            </Button>
            {item.kind === "image" && (
              <Button variant="outline" onClick={() => setZoom((value) => !value)}>
                {zoom ? "原始比例" : "放大"}
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={() => onDetail(item)}>
            查看详情
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AssetDetail({
  projectId,
  storyId,
  item,
  pending,
  error,
  onClose,
  onRename,
}: {
  projectId: string;
  storyId: string;
  item: LibraryAsset;
  pending: boolean;
  error: string;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const root = `/projects/${projectId}/stories/${storyId}`;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="story-asset-drawer">
      <button type="button" className="story-asset-scrim" aria-label="关闭详情" onClick={onClose} />
      <aside className="story-asset-panel" role="dialog" aria-labelledby="asset-detail-title">
        <h3 id="asset-detail-title">资源详情</h3>
        {item.direct_link_id && (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(name.trim());
            }}
          >
            <label className="grid gap-2 text-sm">
              显示名称
              <input className="story-asset-field px-3" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
            </label>
            <Button disabled={pending || !name.trim() || name.trim() === item.name} type="submit">
              保存名称
            </Button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
        <dl className="story-asset-detail">
          <dt>文件</dt>
          <dd title={item.filename}>{item.filename}</dd>
          <dt>类型</dt>
          <dd>{item.mime}</dd>
          <dt>大小</dt>
          <dd>{formatSize(item.size)}</dd>
          {item.width != null && item.height != null && (
            <>
              <dt>分辨率</dt>
              <dd>
                {item.width} × {item.height}
              </dd>
            </>
          )}
          {item.duration_ms != null && (
            <>
              <dt>时长</dt>
              <dd>{formatDuration(item.duration_ms)}</dd>
            </>
          )}
          <dt>时间</dt>
          <dd>{formatTime(item.created_at)}</dd>
          <dt>来源</dt>
          <dd>{item.source === "generated" ? "生成作品" : "上传"}</dd>
        </dl>
        <div className="story-asset-links">
          <p className="text-sm text-muted">引用位置</p>
          {item.references.map((reference) =>
            reference.type === "character" ? (
              <Link key={`${reference.type}-${reference.id}`} to={`${root}/relations?character=${reference.id}`}>
                人物 · {reference.name}
                {reference.primary ? " · 主图" : ""}
              </Link>
            ) : reference.type === "scene" ? (
              <Link key={`${reference.type}-${reference.id}`} to={`${root}/plot`}>
                场景 · {reference.name}
              </Link>
            ) : (
              <span key={`${reference.type}-${reference.id}`}>剧本 · {reference.name}</span>
            ),
          )}
        </div>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      </aside>
    </div>
  );
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
