import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, Clapperboard, Image, Pencil, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { Skeleton } from "../../components/ui/skeleton";
import { graph } from "../character-graph/api";
import { listResources } from "../story-assets/api";
import { plotRoot, read, type Chapters } from "../storyline/api";
import type { Story } from "./api";
import { StoryCover } from "./story-cover";
import "./story-overview.css";

export function StoryOverviewSkeleton() {
  return (
    <div className="story-overview" aria-busy="true" aria-label="正在加载故事">
      <div className="story-hero">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <div className="story-hero-copy">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-16 w-full" />
          <div className="story-hero-actions">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
      </div>
      <div className="story-entries">
        <Skeleton className="h-[72px] rounded-xl" />
        <Skeleton className="h-[72px] rounded-xl" />
        <Skeleton className="h-[72px] rounded-xl" />
      </div>
    </div>
  );
}

export function StoryOverview({
  projectId,
  story,
  onEdit,
}: {
  projectId: string;
  story: Story;
  onEdit: () => void;
}) {
  const root = `/projects/${projectId}/stories/${story.id}`;
  const [preview, setPreview] = useState(false);
  const people = useQuery({
    queryKey: ["projects", projectId, "stories", story.id, "character-graph"],
    queryFn: ({ signal }) => graph(projectId, story.id, signal),
    staleTime: 30_000,
  });
  const chapters = useQuery({
    queryKey: ["plot", projectId, story.id, "chapters"],
    queryFn: ({ signal }) =>
      read<Chapters>(`${plotRoot(projectId, story.id)}/chapters`, signal),
    staleTime: 30_000,
  });
  const resources = useInfiniteQuery({
    queryKey: [
      "projects",
      projectId,
      "stories",
      story.id,
      "resources",
      "all",
      "",
      "newest",
    ],
    queryFn: ({ pageParam, signal }) =>
      listResources(
        projectId,
        story.id,
        {
          category: "all",
          search: "",
          sort: "newest",
          offset: pageParam,
          limit: 24,
        },
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next_offset ?? undefined,
    staleTime: 30_000,
  });
  const latestChapter = [...(chapters.data?.items ?? [])].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  )[0];
  const latestResource = resources.data?.pages[0]?.items[0];
  const recent = [
    latestChapter
      ? {
          href: `${root}/plot`,
          title: latestChapter.title,
          meta: "最近编辑的章节",
          time: latestChapter.updated_at,
        }
      : null,
    latestResource
      ? {
          href: `${root}/resources`,
          title: latestResource.name,
          meta: "最近添加的资源",
          time: latestResource.created_at,
        }
      : null,
  ].filter((item) => item !== null);
  const continuePending = chapters.isPending || resources.isPending;
  const continueFailed =
    !continuePending &&
    recent.length === 0 &&
    (chapters.isError || resources.isError);

  return (
    <div className="story-overview">
      <section className="story-hero" aria-label="故事信息">
        <div className="story-hero-cover">
          <StoryCover key={story.cover_url ?? story.id} url={story.cover_url} />
          <button
            type="button"
            className="story-hero-cover-hit"
            aria-label={story.cover_url ? "预览封面" : "更换封面"}
            onClick={() => (story.cover_url ? setPreview(true) : onEdit())}
          />
          <div className="story-hero-cover-actions">
            {story.cover_url && (
              <button type="button" onClick={() => setPreview(true)}>
                预览封面
              </button>
            )}
            <button type="button" onClick={onEdit}>
              更换封面
            </button>
          </div>
        </div>
        <div className="story-hero-copy">
          <h2 className="story-hero-title">{story.title}</h2>
          <Summary text={story.description ?? ""} onEdit={onEdit} />
          <div className="story-hero-actions">
            <Button variant="outline" onClick={onEdit}>
              <Pencil size={16} />
              编辑故事
            </Button>
            <Button asChild>
              <Link to={`${root}/plot`}>进入剧情</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="story-entries" aria-label="内容入口">
        <Entry
          to={`${root}/relations`}
          icon={<Users size={18} />}
          title="人物关系"
          count={people.isSuccess ? people.data.characters.length : undefined}
          pending={people.isPending}
        />
        <Entry
          to={`${root}/plot`}
          icon={<Clapperboard size={18} />}
          title="剧情"
          count={chapters.isSuccess ? chapters.data.items.length : undefined}
          pending={chapters.isPending}
        />
        <Entry
          to={`${root}/resources`}
          icon={<Image size={18} />}
          title="资源"
          count={
            resources.isSuccess ? resources.data.pages[0]?.total : undefined
          }
          pending={resources.isPending}
        />
      </section>

      <section className="story-continue" aria-label="继续创作">
        <h3>继续创作</h3>
        {continuePending && <Skeleton className="h-14 w-full rounded-xl" />}
        {!continuePending && recent.length > 0 && (
          <ul>
            {recent.map((item) => (
              <li key={item.href + item.title}>
                <Link to={item.href}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.meta}
                      {stamp(item.time) ? ` · ${stamp(item.time)}` : ""}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!continuePending && recent.length === 0 && !continueFailed && (
          <div className="story-continue-empty">
            <p>还没有可继续的章节或资源。</p>
            <div>
              <Link to={`${root}/relations`}>添加人物</Link>
              <Link to={`${root}/plot`}>编写剧情</Link>
              <Link to={`${root}/resources`}>添加资源</Link>
            </div>
          </div>
        )}
        {continueFailed && (
          <div className="story-continue-empty" role="alert">
            <p>最近的创作暂时无法加载。</p>
            <button
              type="button"
              onClick={() => {
                void chapters.refetch();
                void resources.refetch();
              }}
            >
              重试
            </button>
          </div>
        )}
      </section>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent
          className="story-cover-preview"
          style={{ maxWidth: "min(960px, calc(100vw - 32px))" }}
          aria-describedby="story-cover-preview-note"
        >
          <DialogTitle>{story.title}</DialogTitle>
          <DialogDescription id="story-cover-preview-note">
            封面预览
          </DialogDescription>
          {story.cover_url && <img src={story.cover_url} alt={story.title} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Entry({
  to,
  icon,
  title,
  count,
  pending,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  count: number | undefined;
  pending: boolean;
}) {
  return (
    <Link className="story-entry" to={to}>
      <span className="story-entry-icon">{icon}</span>
      <span className="story-entry-copy">
        <strong>{title}</strong>
        {pending ? (
          <Skeleton className="h-4 w-8" />
        ) : count !== undefined ? (
          <em>{count}</em>
        ) : null}
      </span>
      <ChevronRight size={16} />
    </Link>
  );
}

function Summary({ text, onEdit }: { text: string; onEdit: () => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || expanded) return;
    setOverflow(node.scrollHeight > node.clientHeight + 1);
  }, [text, expanded]);
  if (!text.trim()) {
    return (
      <button type="button" className="story-summary-add" onClick={onEdit}>
        添加故事简介
      </button>
    );
  }
  return (
    <div>
      <p
        ref={ref}
        className={expanded ? "story-summary is-open" : "story-summary"}
      >
        {text}
      </p>
      {overflow && (
        <button
          type="button"
          className="story-summary-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function stamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
