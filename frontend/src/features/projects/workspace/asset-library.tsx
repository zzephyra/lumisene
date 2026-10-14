import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../auth";
import { MasonryGallery } from "../../../components/gallery/masonry-gallery";
import { getPublications } from "../../profile/works-api";
import { PublicationButton } from "../../profile/publication-button";
import { Columns3 } from "lucide-react";
import { useGeneratedAssets } from "./use-generated-assets";
import { assetContentPath } from "../image-generation";
import { deleteWork } from "../asset-deletion";
import { userFacingMessage } from "../../../lib/api";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "../../../components/ui/alert-dialog";
import { AlertCircle, ArrowDownUp, Check, Eye, Film, Image as ImageIcon, LayoutGrid, List, Plus, RefreshCw, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import {
  UPLOAD_ACCEPT,
  crossedWorkspaceBoundary,
  formatBytes,
  useUploadAssets,
} from "../../uploads";
import type { AssetUploadItem, UploadCategory, UploadFileRecord } from "../../uploads";
import type { ReferenceAsset } from "./reference-asset";
import "./asset-library.css";

type PreviewTarget = {
  name: string;
  size?: number;
  url: string;
  category: UploadCategory;
};

export function AssetLibrary({
  projectId,
  assetSearch,
  assetType,
  onGenerate,
  setAssetSearch,
  setAssetType,
  setView,
  view,
}: {
  projectId?: string;
  assetSearch: string;
  assetType: string;
  onGenerate: (asset: ReferenceAsset) => void;
  setAssetSearch: (value: string) => void;
  setAssetType: (value: string) => void;
  setView: (value: string) => void;
  view: string;
}) {
  const uploads = useUploadAssets();
  const generated = useGeneratedAssets(projectId);
  const session = useSession();
  const publications = useQuery({ queryKey: ["work-publications", session.data?.id, projectId, generated.items.map(item => item.id).join(",")], queryFn: ({ signal }) => getPublications(projectId!, signal), enabled: !!projectId && !!session.data?.id });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => { setRemoved([]); setDeleteTarget(null); setPreview(null); }, [projectId]);
  const generatedItems = generated.items.filter(item => !removed.includes(item.id) && matches(item.category, item.name, assetType, assetSearch));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const opening = useRef(false);
  const savedIds = new Set(uploads.saved.data?.items.map((item) => item.id) ?? []);
  const heldIds = new Set<string>();
  for (const item of uploads.items) {
    if (item.status === "success" && item.phase !== "ready" && item.record) {
      heldIds.add(item.record.id);
    }
  }
  const localItems = uploads.items.filter((item) => {
    const settled = item.status === "success" && item.phase === "ready" && item.record !== null && savedIds.has(item.record.id);
    return !settled && matches(item.category, item.file.name, assetType, assetSearch);
  });
  const savedItems = (uploads.saved.data?.items ?? []).filter(
    (item) => !heldIds.has(item.id) && matches(item.category, item.original_filename, assetType, assetSearch),
  );
  const empty = localItems.length === 0 && savedItems.length === 0 && generatedItems.length === 0;

  useEffect(() => {
    const block = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
        event.preventDefault();
      }
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function acceptFiles(files: File[]) {
    uploads.uploadAssets(files);
  }

  function generate(asset: ReferenceAsset) {
    if (opening.current) {
      return;
    }
    opening.current = true;
    onGenerate(asset);
    window.setTimeout(() => {
      opening.current = false;
    }, 600);
  }

  return (
    <main className="workspace-content asset-library">
      <div className="workspace-page-heading">
        <div>
          <span className="workspace-eyebrow">YOUR CREATIVE LIBRARY</span>
          <h1>资产</h1>
          <p>当前项目的生成作品与上传素材，集中管理和再次创作。</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus size={16} /> 添加素材
        </Button>
      </div>
      <div className="asset-toolbar">
        <div className="asset-filters" aria-label="资产类型">
          {["全部作品", "图片", "视频"].map((type) => (
            <button aria-pressed={assetType === type} className={assetType === type ? "active" : ""} key={type} onClick={() => setAssetType(type)} type="button">
              {type}
            </button>
          ))}
        </div>
        <div className="asset-tools">
          <label className="asset-search">
            <Search size={16} />
            <Input aria-label="搜索资产" onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索资产名称" value={assetSearch} />
          </label>
          <Button aria-label="按时间排序" disabled title="资产服务接入后开放排序" variant="ghost">
            <ArrowDownUp size={17} />
          </Button>
          <div className="view-toggle">
            <Button aria-label="网格视图" aria-pressed={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} variant="ghost">
              <LayoutGrid size={17} />
            </Button>
            <Button aria-label="瀑布流视图" aria-pressed={view === "masonry"} className={view === "masonry" ? "active" : ""} onClick={() => setView("masonry")} variant="ghost"><Columns3 size={17} /></Button>
            <Button aria-label="列表视图" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")} variant="ghost">
              <List size={18} />
            </Button>
          </div>
        </div>
      </div>
      {referenceError && <p role="alert">{referenceError}</p>}
      {generated.loading && <p role="status">正在加载生成作品…</p>}
      {generated.error && <div role="alert">{generated.error}<Button variant="ghost" onClick={generated.refresh}>重新加载</Button></div>}
      <section
        aria-label="素材工作区"
        className={`workspace-empty asset-workspace ${view}${dragging ? " is-dragover" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!Array.from(event.dataTransfer.types).includes("Files")) {
            return;
          }
          if (!crossedWorkspaceBoundary(event.currentTarget, event.relatedTarget)) {
            return;
          }
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!crossedWorkspaceBoundary(event.currentTarget, event.relatedTarget)) {
            return;
          }
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          setDragging(dragDepth.current > 0);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          acceptFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {dragging ? (
          <div className="asset-drag-overlay">
            <Upload size={22} />
            <strong>松开以上传素材</strong>
            <span>支持图片、视频等项目素材</span>
          </div>
        ) : null}
        {empty ? (
          <div className="asset-empty">
            <h2>暂无素材</h2>
            <p>将图片或视频拖到这里</p>
            <Button onClick={() => setDialogOpen(true)} variant="outline">
              <Plus size={16} /> 添加素材
            </Button>
          </div>
        ) : (
          <MasonryGallery enabled={view === "masonry"} className={view === "masonry" ? "" : "asset-grid"}>
            {generatedItems.map(item => {
              const url = assetContentPath(projectId!, item.id);
              const publication = publications.data?.find(value => value.id === item.id);
              return <article className="asset-card is-ready" key={`generated-${item.id}`}>
                <MediaThumb category={item.category} name={item.name} url={url} reveal={false} onPreview={() => setPreview({ name: item.name, url, category: item.category })} />
                <div className="asset-card-meta"><strong title={item.name}>{item.name}</strong><span>{item.category === "image" ? "AI 生成图片" : "AI 生成视频"}</span></div>
                {publication && <PublicationButton projectId={projectId!} publication={publication} />}
                <ReadyActions name={item.name} onGenerate={() => { if (opening.current) return; opening.current = true; setReferenceError(""); void fetch(url, { credentials: "same-origin" }).then(async response => { if (!response.ok) throw new Error("作品读取失败"); const blob = await response.blob(); onGenerate({ id: item.id, name: item.name, url: new URL(url, window.location.origin).href, size: blob.size, category: item.category }); }).catch(() => setReferenceError("作品读取失败，请重试。")).finally(() => { opening.current = false; }); }} onRemove={() => { setDeleteError(""); setDeleteTarget(item.id); }} />
              </article>;
            })}
            {localItems.map((item) => (
              <UploadCard
                item={item}
                key={item.localId}
                onCancel={() => uploads.cancelAsset(item.localId)}
                onGenerate={generate}
                onPreview={setPreview}
                onRemove={() => {
                  if (item.record) {
                    void uploads.removeSaved(item.record.id);
                  }
                  uploads.removeLocal(item.localId);
                }}
                onRetry={() => uploads.retryAsset(item.localId)}
              />
            ))}
            {savedItems.map((item) => (
              <SavedCard
                item={item}
                key={item.id}
                onGenerate={generate}
                onPreview={setPreview}
                onRemove={() => void uploads.removeSaved(item.id)}
              />
            ))}
          </MasonryGallery>
        )}
      </section>
      {publications.isError && <p role="alert">公开状态加载失败。<Button variant="ghost" onClick={() => void publications.refetch()}>重试</Button></p>}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogTitle>删除这件生成作品？</AlertDialogTitle><AlertDialogDescription>作品将从资产和生成记录中隐藏，云端文件按系统设置处理。</AlertDialogDescription>{deleteError && <p role="alert">{deleteError}</p>}<div className="work-delete-actions"><Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" disabled={deleting} onClick={() => { if (!projectId || !deleteTarget) return; const id = deleteTarget; setDeleting(true); void deleteWork(projectId, id).then(() => { setRemoved(current => [...current, id]); setDeleteTarget(null); generated.refresh(); }).catch(reason => setDeleteError(userFacingMessage(reason))).finally(() => setDeleting(false)); }}>{deleting ? "正在删除…" : "确认删除"}</Button></div></AlertDialogContent></AlertDialog>
      <AssetUploadDialog onOpenChange={setDialogOpen} onSelect={acceptFiles} open={dialogOpen} />
      {preview ? (
        <Dialog open onOpenChange={(open) => { if (!open) setPreview(null); }}>
          <DialogContent
            className="asset-preview-dialog w-auto max-w-[90vw] border-0 bg-transparent p-0 pt-10 shadow-none"
            overlayClassName="asset-preview-overlay"
          >
            <DialogTitle className="asset-preview-title">{preview.name}</DialogTitle>
            <DialogDescription className="asset-preview-size">{preview.size === undefined ? "生成作品" : formatBytes(preview.size)}</DialogDescription>
            <PreviewMedia preview={preview} />
          </DialogContent>
        </Dialog>
      ) : null}
      {uploads.notice ? (
        <p className="generation-toast" data-tone={uploads.notice.tone} role="status">
          {uploads.notice.message}
        </p>
      ) : null}
    </main>
  );
}

function AssetUploadDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  function take(files: File[]) {
    if (files.length === 0) {
      return;
    }
    onSelect(files);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="asset-upload-dialog">
        <DialogTitle>添加素材</DialogTitle>
        <DialogDescription>上传图片、视频或其他项目素材</DialogDescription>
        <div
          className={over ? "asset-dropzone is-over" : "asset-dropzone"}
          onDragEnter={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!crossedWorkspaceBoundary(event.currentTarget, event.relatedTarget)) {
              return;
            }
            depth.current += 1;
            setOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!crossedWorkspaceBoundary(event.currentTarget, event.relatedTarget)) {
              return;
            }
            depth.current = Math.max(0, depth.current - 1);
            setOver(depth.current > 0);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            depth.current = 0;
            setOver(false);
            take(Array.from(event.dataTransfer.files));
          }}
        >
          <Upload size={20} />
          <strong>拖拽文件到这里</strong>
          <span>或</span>
          <Button onClick={() => input.current?.click()} type="button" variant="outline">
            选择文件
          </Button>
          <small>支持 JPG、PNG、WebP、GIF、MP4、WebM、MOV</small>
        </div>
        <input
          accept={UPLOAD_ACCEPT}
          hidden
          multiple
          onChange={(event) => {
            take(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
          ref={input}
          type="file"
        />
      </DialogContent>
    </Dialog>
  );
}

function UploadCard({
  item,
  onCancel,
  onGenerate,
  onPreview,
  onRemove,
  onRetry,
}: {
  item: AssetUploadItem;
  onCancel: () => void;
  onGenerate: (asset: ReferenceAsset) => void;
  onPreview: (preview: PreviewTarget) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const [objectUrl] = useState(() =>
    item.category === "image" || item.category === "video" ? URL.createObjectURL(item.file) : "",
  );
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);
  const record = item.record;
  const busy = item.status === "preparing" || item.status === "uploading";
  const failed = item.status === "error";
  const url = record?.url || objectUrl;
  const preview = { name: item.file.name, size: item.file.size, url, category: item.category };
  return (
    <article className={`asset-card${failed ? " is-error" : ""}${item.status === "success" && item.phase !== "check" ? " is-ready" : ""}`}>
      {busy ? <UploadPlaceholder name={item.file.name} percent={item.percent} /> : null}
      {failed ? (
        <div className="asset-status-panel">
          <AlertCircle className="asset-error-mark" size={22} />
          <strong>上传失败</strong>
          <span>{item.message || "请重新上传"}</span>
          <small>{item.file.name}</small>
        </div>
      ) : null}
      {item.status === "cancelled" ? (
        <div className="asset-status-panel">
          <strong>已取消上传</strong>
          <small>{item.file.name}</small>
        </div>
      ) : null}
      {item.status === "success" && item.phase === "check" ? (
        <div className="asset-status-panel is-done">
          <Check size={22} />
          <strong>上传完成</strong>
        </div>
      ) : null}
      {item.status === "success" && item.phase !== "check" ? (
        <MediaThumb category={item.category} name={item.file.name} onPreview={() => onPreview(preview)} reveal={item.phase === "fade"} url={url} />
      ) : null}
      {failed || item.status === "cancelled" ? null : (
        <div className="asset-card-meta">
          <strong title={item.file.name}>{item.file.name}</strong>
          <span>{formatBytes(item.file.size)}</span>
        </div>
      )}
      {busy ? (
        <div className="asset-card-actions">
          <Button className="asset-cancel h-8 px-3" onClick={onCancel} variant="ghost">取消上传</Button>
        </div>
      ) : null}
      {failed ? (
        <div className="asset-card-actions">
          <Button className="h-8 px-3" onClick={onRetry} variant="outline">
            <RefreshCw size={14} /> 重新上传
          </Button>
          <Button aria-label={`删除 ${item.file.name}`} className="asset-delete h-8 w-8 px-0" onClick={onRemove} variant="ghost">
            <Trash2 size={15} />
          </Button>
        </div>
      ) : null}
      {item.status === "success" && record ? (
        <ReadyActions name={item.file.name} onGenerate={() => onGenerate(toReference(record))} onRemove={onRemove} />
      ) : null}
      {item.status === "cancelled" ? (
        <div className="asset-card-actions">
          <Button aria-label={`删除 ${item.file.name}`} className="asset-delete h-8 w-8 px-0" onClick={onRemove} variant="ghost">
            <Trash2 size={15} />
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function SavedCard({
  item,
  onGenerate,
  onPreview,
  onRemove,
}: {
  item: UploadFileRecord;
  onGenerate: (asset: ReferenceAsset) => void;
  onPreview: (preview: PreviewTarget) => void;
  onRemove: () => void;
}) {
  return (
    <article className="asset-card is-ready">
      <MediaThumb
        category={item.category}
        name={item.original_filename}
        onPreview={() => onPreview({ name: item.original_filename, size: item.size, url: item.url, category: item.category })}
        reveal={false}
        url={item.url}
      />
      <div className="asset-card-meta">
        <strong title={item.original_filename}>{item.original_filename}</strong>
        <span>{formatBytes(item.size)}</span>
      </div>
      <ReadyActions name={item.original_filename} onGenerate={() => onGenerate(toReference(item))} onRemove={onRemove} />
    </article>
  );
}

function ReadyActions({ name, onGenerate, onRemove }: { name: string; onGenerate: () => void; onRemove: () => void }) {
  return (
    <div className="asset-card-actions">
      <Button className="asset-generate h-8 px-3" onClick={onGenerate}>
        <Sparkles size={14} /> 生成
      </Button>
      <Button aria-label={`删除 ${name}`} className="asset-delete h-8 w-8 px-0" onClick={onRemove} variant="ghost">
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

function MediaThumb({
  category,
  name,
  onPreview,
  reveal,
  url,
}: {
  category: UploadCategory;
  name: string;
  onPreview: () => void;
  reveal: boolean;
  url: string;
}) {
  const [broken, setBroken] = useState(false);
  const revealClass = reveal ? " is-reveal" : "";
  let visual = <span className="asset-card-preview asset-card-icon">{category === "video" ? <Film size={18} /> : <ImageIcon size={18} />}</span>;
  if (!broken && url && category === "image") {
    visual = <img alt="" className={`asset-card-preview${revealClass}`} onError={() => setBroken(true)} src={url} />;
  } else if (!broken && url && category === "video") {
    visual = (
      <video
        aria-hidden
        className={`asset-card-preview${revealClass}`}
        muted
        onError={() => setBroken(true)}
        playsInline
        preload="metadata"
        src={url}
      />
    );
  } else if (broken) {
    visual = <span className="asset-card-preview asset-card-icon">无法显示</span>;
  }
  return (
    <button aria-label={`预览 ${name}`} className="asset-thumb" onClick={onPreview} type="button">
      {visual}
      <span className="asset-thumb-overlay">
        <Eye size={16} />
        <span>预览</span>
      </span>
    </button>
  );
}

function UploadPlaceholder({ name, percent }: { name: string; percent: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="asset-skeleton">
      <span className="asset-spinner" />
      <strong>正在上传</strong>
      <em>{value}%</em>
      <div aria-label={`${name} 上传进度`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={value} className="asset-progress" role="progressbar">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function PreviewMedia({ preview }: { preview: PreviewTarget }) {
  const [broken, setBroken] = useState(false);
  if (preview.category === "file" || broken || !preview.url) {
    return <p className="asset-preview-fallback">无法预览这个文件</p>;
  }
  if (preview.category === "video") {
    return <video className="asset-preview-media is-video" controls onError={() => setBroken(true)} preload="metadata" src={preview.url} />;
  }
  return <img alt={preview.name} className="asset-preview-media" onError={() => setBroken(true)} src={preview.url} />;
}

function toReference(item: UploadFileRecord): ReferenceAsset {
  return {
    id: item.id,
    name: item.original_filename,
    url: item.url,
    size: item.size,
    category: item.category,
  };
}

function matches(category: UploadCategory, name: string, assetType: string, assetSearch: string): boolean {
  const query = assetSearch.trim().toLowerCase();
  if (query && !name.toLowerCase().includes(query)) {
    return false;
  }
  if (assetType === "图片") {
    return category === "image";
  }
  if (assetType === "视频") {
    return category === "video";
  }
  return true;
}
