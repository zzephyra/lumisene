import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MasonryGallery } from "../../components/gallery/masonry-gallery";
import { VideoPlayer } from "../../components/media/video-player";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { getPublicWorks, publicContentPath, type PublicWork } from "./works-api";
import "./public-work-gallery.css";

export function PublicWorkGallery({ userId, kind }: { userId: string; kind: "image" | "video" }) {
  const [preview, setPreview] = useState<PublicWork | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["public-works", userId, kind], initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => getPublicWorks(userId, kind, pageParam, signal),
    getNextPageParam: (last, pages) => last.length === 24 ? pages.length * 24 : undefined,
    refetchInterval: 30000,
  });
  const items = query.data?.pages.flat() ?? [];
  return <>
    {query.isPending && <p role="status">正在加载公开作品…</p>}
    {query.isError && <p role="alert">作品加载失败。<Button variant="ghost" onClick={() => void query.refetch()}>重试</Button></p>}
    {!query.isPending && !query.isError && !items.length && <section className="profile-empty"><h2>还没有公开的{kind === "image" ? "图片" : "视频"}作品</h2><p>公开后的作品会展示在这里。</p></section>}
    <MasonryGallery>{items.map(item => <button type="button" className="public-work-card" key={item.id} aria-label={`查看${item.kind === "image" ? "图片" : "视频"}作品`} onClick={() => setPreview(item)}>
      {item.kind === "image" ? <img src={publicContentPath(userId, item.id)} alt="公开的图片作品" width={item.width ?? undefined} height={item.height ?? undefined} loading="lazy" /> : <video src={publicContentPath(userId, item.id)} muted playsInline preload="metadata" width={item.width ?? undefined} height={item.height ?? undefined} />}
      <span>{item.kind === "video" ? "播放视频" : "查看作品"}</span>
    </button>)}</MasonryGallery>
    {query.hasNextPage && <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} variant="outline">{query.isFetchingNextPage ? "加载中…" : "加载更多"}</Button>}
    {preview && <Dialog open onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="public-work-preview"><DialogTitle>公开作品</DialogTitle>{preview.kind === "image" ? <img src={publicContentPath(userId, preview.id)} alt="图片作品预览" /> : <VideoPlayer src={publicContentPath(userId, preview.id)} />}</DialogContent></Dialog>}
  </>;
}
