import { useQuery } from "@tanstack/react-query";
import { listResources, type LibraryAsset } from "./api";
import "./library.css";

/** Selects an existing story image. Callers own where the chosen asset is attached. */
export function AssetPicker({
  projectId,
  storyId,
  onSelect,
}: {
  projectId: string;
  storyId: string;
  onSelect: (asset: LibraryAsset) => void;
}) {
  const query = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "resources", "picker"],
    queryFn: ({ signal }) => listResources(projectId, storyId, { category: "all", limit: 24 }, signal),
  });
  const images = query.data?.items.filter((item) => item.kind === "image") ?? [];
  if (query.isPending) return <p className="text-sm text-muted">正在加载资源…</p>;
  if (query.isError) return <p role="alert">资源加载失败</p>;
  if (!images.length) return <p className="text-sm text-muted">当前剧本还没有可选图片。</p>;
  return (
    <div className="story-asset-grid">
      {images.map((item) => (
        <button key={`${item.source}-${item.id}`} type="button" className="story-asset-card" onClick={() => onSelect(item)}>
          {item.thumbnail_url && <img alt="" loading="lazy" src={item.thumbnail_url} />}
          <span className="story-asset-name">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
