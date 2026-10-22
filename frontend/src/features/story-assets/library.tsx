import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, FileText, Film, ImageIcon, Play } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { isApiError } from "../../lib/api";
import {
  libraryOptions,
  listResources,
  removeResource,
  renameResource,
  type LibraryAsset,
  type LibraryCategory,
  type LibrarySort,
} from "./api";
import "./library.css";
import { AssetDetail, AssetPreview } from "./preview";
import { AssetUploadDialog } from "./upload-dialog";

const TABS: { id: LibraryCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "character", label: "人物" },
  { id: "scene", label: "场景" },
  { id: "shot", label: "分镜" },
  { id: "video", label: "视频" },
  { id: "document", label: "文档" },
];

export function StoryAssetLibrary({ projectId, storyId }: { projectId: string; storyId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<LibraryCategory>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [preview, setPreview] = useState<number | null>(null);
  const [detail, setDetail] = useState<LibraryAsset | null>(null);
  const [confirm, setConfirm] = useState<{ item: LibraryAsset; original: boolean } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSession, setUploadSession] = useState(0);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const options = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "resources", "options"],
    queryFn: ({ signal }) => libraryOptions(projectId, storyId, signal),
  });
  const resources = useInfiniteQuery({
    queryKey: ["projects", projectId, "stories", storyId, "resources", category, search, sort],
    queryFn: ({ pageParam, signal }) =>
      listResources(projectId, storyId, { category, search, sort, offset: pageParam, limit: 24 }, signal),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next_offset ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const items = resources.data?.pages.flatMap((page) => page.items) ?? [];
  const root = `/projects/${projectId}/stories/${storyId}`;

  function openUpload(files: File[] = []) {
    setUploadFiles(files);
    setUploadSession((value) => value + 1);
    setUploadOpen(true);
  }

  function dragEnter(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  }

  function dragLeave(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragging(false);
    }
  }

  function drop(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    openUpload([...(event.dataTransfer.files ?? [])]);
  }

  async function rename(item: LibraryAsset, name: string) {
    setPending(true);
    setActionError("");
    try {
      const next = await renameResource(projectId, storyId, item, name);
      setDetail(next);
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "stories", storyId, "resources"],
      });
    } catch (error) {
      setActionError(reason(error));
    } finally {
      setPending(false);
    }
  }

  async function remove(item: LibraryAsset, original: boolean) {
    setPending(true);
    setActionError("");
    try {
      await removeResource(projectId, storyId, item, original);
      setConfirm(null);
      setDetail(null);
      setPreview(null);
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "stories", storyId, "resources"],
      });
    } catch (error) {
      setActionError(reason(error));
    } finally {
      setPending(false);
    }
  }

  function locate(item: LibraryAsset) {
    const character = item.references.find((reference) => reference.type === "character");
    if (character) {
      navigate(`${root}/relations?character=${character.id}`);
      return;
    }
    if (item.references.some((reference) => reference.type === "scene")) {
      navigate(`${root}/plot`);
      return;
    }
    setDetail(item);
  }

  return (
    <section className="story-library">
      <header className="story-library-head">
        <div>
          <h2>资源库</h2>
          <p>管理当前剧本的视觉素材与参考资料</p>
        </div>
        <Button onClick={() => openUpload()}>+ 添加资源</Button>
      </header>
      <div className="story-library-tabs" role="tablist" aria-label="资源分类">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={category === tab.id}
            onClick={() => setCategory(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="story-library-tools">
        <input
          className="story-library-search"
          value={searchInput}
          placeholder="搜索资源…"
          aria-label="搜索资源"
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <select
          className="story-library-sort"
          aria-label="排序"
          value={sort}
          onChange={(event) => setSort(event.target.value as LibrarySort)}
        >
          <option value="newest">最新添加</option>
          <option value="oldest">最早添加</option>
          <option value="name">名称排序</option>
        </select>
      </div>
      <div
        className="story-library-body"
        onDragEnter={dragEnter}
        onDragOver={(event) => {
          if (hasFiles(event)) event.preventDefault();
        }}
        onDragLeave={dragLeave}
        onDrop={drop}
      >
        {dragging && <div className="story-asset-drop">松开以上传资源</div>}
        {resources.isPending && (
          <div className="story-asset-grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/3] rounded-xl" />
            ))}
          </div>
        )}
        {resources.isError && !resources.isPlaceholderData && (
          <div className="story-asset-error" role="alert">
            <h3>资源加载失败</h3>
            <p>{reason(resources.error)}</p>
            <Button className="mt-4" variant="outline" onClick={() => void resources.refetch()}>
              重新加载
            </Button>
          </div>
        )}
        {!resources.isPending && !resources.isError && items.length === 0 && (
          <Empty category={category} searching={search.length > 0} onAdd={() => openUpload()} />
        )}
        {!resources.isPending && items.length > 0 && (
          <>
            <div className="story-asset-grid">
              {items.map((item, index) => (
                <AssetCard
                  key={`${item.source}-${item.id}`}
                  item={item}
                  onPreview={() => setPreview(index)}
                  onDetail={() => setDetail(item)}
                  onLocate={() => locate(item)}
                  onRemove={() => {
                    setActionError("");
                    setConfirm({ item, original: false });
                  }}
                  onDelete={() => {
                    setActionError("");
                    setConfirm({ item, original: true });
                  }}
                />
              ))}
            </div>
            {resources.hasNextPage && (
              <div className="story-asset-more">
                <Button variant="outline" disabled={resources.isFetchingNextPage} onClick={() => void resources.fetchNextPage()}>
                  {resources.isFetchingNextPage ? "正在加载…" : "加载更多"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <AssetUploadDialog
        open={uploadOpen}
        projectId={projectId}
        storyId={storyId}
        options={options.data}
        session={uploadSession}
        initialFiles={uploadFiles}
        onClose={() => setUploadOpen(false)}
      />
      {preview != null && (
        <AssetPreview
          projectId={projectId}
          storyId={storyId}
          items={items}
          index={preview}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
          onDetail={(item) => setDetail(item)}
        />
      )}
      {detail && (
        <AssetDetail
          projectId={projectId}
          storyId={storyId}
          item={detail}
          pending={pending}
          error={actionError}
          onClose={() => setDetail(null)}
          onRename={(name) => void rename(detail, name)}
        />
      )}
      <Dialog open={confirm != null} onOpenChange={(next) => !next && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>{confirm?.original ? "删除原文件" : "从当前剧本移除"}</DialogTitle>
          <DialogDescription>
            {confirm?.original
              ? "这会删除文件本身。如果人物、封面或其他剧本仍在使用，删除会被拒绝。"
              : "只解除当前剧本自己添加的引用。人物档案中的图片和原始文件都会保留。"}
          </DialogDescription>
          {actionError && <p role="alert">{actionError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant={confirm?.original ? "danger" : "primary"}
              disabled={pending || !confirm}
              onClick={() => confirm && void remove(confirm.item, confirm.original)}
            >
              {confirm?.original ? "删除原文件" : "移除引用"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AssetCard({
  item,
  onPreview,
  onDetail,
  onLocate,
  onRemove,
  onDelete,
}: {
  item: LibraryAsset;
  onPreview: () => void;
  onDetail: () => void;
  onLocate: () => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const primary = item.references.some((reference) => reference.primary);
  return (
    <article className="story-asset-card">
      <button type="button" className="story-asset-thumb" onClick={onPreview}>
        {item.kind === "image" && item.thumbnail_url && (
          <img alt="" loading="lazy" src={item.thumbnail_url} />
        )}
        {item.kind === "image" && !item.thumbnail_url && <ImageIcon aria-hidden />}
        {item.kind === "video" && (
          <>
            <Film aria-hidden />
            <span className="story-asset-play">
              <Play size={14} />
            </span>
            {item.duration_ms != null && <span className="story-asset-duration">{clock(item.duration_ms)}</span>}
          </>
        )}
        {item.kind === "document" && (
          <span className="story-asset-doc">
            <FileText aria-hidden />
            <strong>{extension(item)}</strong>
          </span>
        )}
        {primary && <span className="story-asset-primary">主图</span>}
      </button>
      <div className="story-asset-meta">
        <p className="story-asset-name" title={item.name}>
          {item.name}
        </p>
        <p className="story-asset-sub" title={caption(item)}>
          {caption(item)}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="story-asset-menu size-8 px-0" aria-label={`${item.name}的更多操作`}>
              <Ellipsis size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onPreview}>预览</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDetail}>查看详情</DropdownMenuItem>
            {item.direct_link_id && <DropdownMenuItem onSelect={onDetail}>重命名</DropdownMenuItem>}
            <DropdownMenuItem onSelect={onLocate}>查看所属位置</DropdownMenuItem>
            {item.direct_link_id && <DropdownMenuItem onSelect={onRemove}>从当前剧本移除</DropdownMenuItem>}
            {item.can_delete && <DropdownMenuItem onSelect={onDelete}>删除原文件</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function Empty({
  category,
  searching,
  onAdd,
}: {
  category: LibraryCategory;
  searching: boolean;
  onAdd: () => void;
}) {
  const copy = searching
    ? { title: "没有匹配的资源", detail: "试试其他名称，或切换分类。" }
    : EMPTY[category];
  return (
    <div className="story-asset-empty">
      <h3>{copy.title}</h3>
      <p>{copy.detail}</p>
      {category === "all" && !searching && (
        <Button className="mt-4" onClick={onAdd}>
          添加资源
        </Button>
      )}
    </div>
  );
}

const EMPTY: Record<LibraryCategory, { title: string; detail: string }> = {
  all: {
    title: "还没有任何资源",
    detail: "上传图片、视频或文档，为你的故事准备创作素材。",
  },
  character: {
    title: "暂无人物形象",
    detail: "在人物关系中添加人物图片后，它们会出现在这里。",
  },
  scene: {
    title: "暂无场景素材",
    detail: "添加场景参考图后，它们会出现在这里。",
  },
  shot: {
    title: "暂无分镜素材",
    detail: "当你创建分镜参考图后，它们会出现在这里。",
  },
  video: {
    title: "暂无视频素材",
    detail: "上传视频后，它们会出现在这里。",
  },
  document: {
    title: "暂无文档",
    detail: "上传 PDF、TXT 或 Markdown 后，它们会出现在这里。",
  },
};

function hasFiles(event: DragEvent) {
  return [...event.dataTransfer.types].includes("Files");
}

function caption(item: LibraryAsset) {
  const people = item.references.filter((reference) => reference.type === "character");
  if (people.length) return people.map((person) => person.name).join("、");
  const scene = item.references.find((reference) => reference.type === "scene");
  if (scene) return scene.name;
  if (item.kind === "document") return `${extension(item)} · ${bytes(item.size)}`;
  if (item.kind === "video") return "视频";
  if (item.category === "shot") return "分镜";
  if (item.category === "scene") return "场景";
  return "图片";
}

function extension(item: LibraryAsset) {
  if (item.mime === "application/pdf") return "PDF";
  if (item.mime === "text/markdown") return "Markdown";
  if (item.mime === "text/plain") return "TXT";
  return item.filename.split(".").pop()?.toUpperCase() || "文件";
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function reason(error: unknown) {
  if (isApiError(error) && error.message) return error.message;
  return "无法连接服务器，请重试";
}
