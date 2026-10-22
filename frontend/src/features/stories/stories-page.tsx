import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { isApiError } from "../../lib/api";
import {
  createStory,
  deleteStory,
  listStories,
  updateStory,
  type Story,
  type StoryInput,
} from "./api";
import { StoryCover } from "./story-cover";
import { StoryDialog } from "./story-dialog";

export function StoriesPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["projects", projectId, "stories"],
    queryFn: ({ pageParam, signal }) =>
      listStories(projectId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });
  const [editing, setEditing] = useState<Story | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Story | null>(null);

  const stories = query.data?.pages.flatMap((page) => page.items) ?? [];

  async function save(value: StoryInput) {
    setPending(true);
    setError("");
    try {
      if (editing) {
        await updateStory(projectId, editing.id, {
          ...value,
          expected_version: editing.version,
        });
      } else {
        await createStory(projectId, value);
      }
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "stories"],
      });
      setEditing(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      if (isApiError(reason) && reason.code === "version_conflict") {
        await query.refetch();
      }
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      await deleteStory(projectId, removing.id, removing.version);
      setRemoving(null);
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "stories"],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
      setRemoving(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="min-w-0 overflow-x-hidden px-4 py-6 md:px-8 md:py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">故事</h1>
          <p className="mt-1 text-sm text-muted">管理和创作项目中的故事</p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setEditing(null);
          }}
        >
          <Plus size={16} /> 新建故事
        </Button>
      </header>
      {query.isPending && (
        <StoryGrid>
          {Array.from({ length: 6 }, (_, index) => (
            <StorySkeleton key={index} />
          ))}
        </StoryGrid>
      )}
      {query.isError && (
        <div
          className="rounded-xl border border-line bg-panel p-8 text-center"
          role="alert"
        >
          <p>故事列表加载失败</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            重试
          </Button>
        </div>
      )}
      {query.isSuccess && stories.length === 0 && (
        <div className="rounded-xl border border-line bg-panel px-6 py-16 text-center">
          <p>还没有故事，创建你的第一个故事。</p>
          <Button
            className="mt-4"
            onClick={() => {
              setError("");
              setEditing(null);
            }}
          >
            新建故事
          </Button>
        </div>
      )}
      {query.isSuccess && stories.length > 0 && (
        <StoryGrid>
          {stories.map((item) => (
            <article
              key={item.id}
              className="relative min-w-0 overflow-hidden rounded-xl border border-line bg-panel transition-shadow duration-150 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
            >
              <Link
                className="block min-w-0 text-inherit"
                to={`/projects/${projectId}/stories/${item.id}`}
              >
                <StoryCover
                  key={item.cover_url ?? item.id}
                  url={item.cover_url}
                />
                <div className="p-4">
                  <h2
                    className="truncate text-sm font-semibold"
                    title={item.title}
                  >
                    {item.title}
                  </h2>
                  <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted">
                    {item.description || "暂无介绍"}
                  </p>
                </div>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${item.title}的操作`}
                  className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-lg bg-panel/90 text-ink"
                >
                  <Ellipsis size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setError("");
                      setEditing(item);
                    }}
                  >
                    编辑
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRemoving(item)}>
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          ))}
        </StoryGrid>
      )}
      {query.hasNextPage && (
        <div className="mt-6 text-center">
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "正在加载…" : "加载更多"}
          </Button>
        </div>
      )}
      {error && editing === undefined && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <StoryDialog
        error={editing === undefined ? "" : error}
        onClose={() => {
          if (!pending) {
            setEditing(undefined);
            setError("");
          }
        }}
        onSubmit={(value) => void save(value)}
        open={editing !== undefined}
        pending={pending}
        story={editing ?? null}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>删除故事？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后无法从列表恢复「{removing?.title}」。
          </AlertDialogDescription>
          <div className="mt-6 flex justify-end gap-3">
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              删除
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function StoryGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-5">
      {children}
    </div>
  );
}

function StorySkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-2 h-8 w-full" />
      </div>
    </div>
  );
}
