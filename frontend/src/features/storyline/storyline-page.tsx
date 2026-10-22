import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Plus,
  Sparkles,
  Ellipsis,
  BookOpen,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import { Select } from "../../components/ui/select";
import { graph } from "../character-graph/api";
import { AIStoryDialog } from "./ai-dialog";
import { SceneEditor } from "./scene-editor";
import {
  read,
  write,
  plotRoot,
  message,
  type Chapter,
  type Chapters,
  type Scene,
  type Scenes,
  type Generate,
  type Job,
} from "./api";
import "./storyline.css";

export function StorylinePage({
  projectId,
  storyId,
}: {
  projectId: string;
  storyId: string;
}) {
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const root = plotRoot(projectId, storyId);
  const [chapterId, setChapterId] = useState<string>(),
    [scene, setScene] = useState<Scene>();
  const [edit, setEdit] = useState<{
      kind: "chapter" | "scene";
      value?: Chapter | Scene;
    }>(),
    [deleting, setDeleting] = useState<{
      kind: "chapter" | "scene";
      value: Chapter | Scene;
    }>();
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [drag, setDrag] = useState<string>();
  const [ai, setAI] = useState<Generate>(),
    [jobId, setJobId] = useState<string>();
  const chapters = useQuery({
    queryKey: ["plot", projectId, storyId, "chapters"],
    queryFn: ({ signal }) => read<Chapters>(root + "/chapters", signal),
  });
  const scenes = useQuery({
    queryKey: ["plot", projectId, storyId, chapterId, "scenes"],
    queryFn: ({ signal }) =>
      read<Scenes>(root + `/chapters/${chapterId}/scenes`, signal),
    enabled: !!chapterId,
  });
  const jobs = useQuery({
    queryKey: ["plot", projectId, storyId, "jobs"],
    queryFn: ({ signal }) => read<Job[]>(root + "/jobs", signal),
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.status === "queued" || j.status === "running")
        ? 1500
        : false,
  });
  const people = useQuery({
    queryKey: ["character-graph", projectId, storyId],
    queryFn: ({ signal }) => graph(projectId, storyId, signal),
    enabled: !!chapterId,
  });
  const current = chapters.data?.items.find((c) => c.id === chapterId);
  const items = chapterId
    ? (scenes.data?.items ?? [])
    : (chapters.data?.items ?? []);
  const refresh = () => {
    void chapters.refetch();
    if (chapterId) void scenes.refetch();
    void jobs.refetch();
  };
  async function mutate(task: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await task();
      refresh();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  async function reorder(id: string, target: number) {
    const next = items.map((i) => i.id),
      from = next.indexOf(id);
    if (from < 0 || target < 0 || target >= next.length) return;
    next.splice(target, 0, next.splice(from, 1)[0]);
    await mutate(() =>
      write(
        root +
          (chapterId
            ? `/chapters/${chapterId}/scenes/order`
            : "/chapters/order"),
        "PUT",
        {
          ids: next,
          expected_version: chapterId
            ? scenes.data?.version
            : chapters.data?.version,
        },
      ),
    );
  }
  const openAI = (request: Generate) => {
    setJobId(undefined);
    setAI(request);
  };
  const openJob = async (job: Job) => {
    if (saveRef.current && !(await saveRef.current())) return;
    setJobId(job.id);
    setAI(job.request);
  };
  return (
    <div className="plot-page">
      {error && (
        <div role="alert" className="plot-error">
          {error}
        </div>
      )}
      {scene ? (
        <SceneEditor
          key={scene.id + ":" + scene.version}
          root={root}
          saveRef={saveRef}
          projectId={projectId}
          storyId={storyId}
          scene={scene}
          onBack={() => setScene(undefined)}
          onSaved={() => void scenes.refetch()}
          onAI={openAI}
        />
      ) : (
        <>
          <header className="plot-heading">
            <div>
              {chapterId && (
                <Button variant="ghost" onClick={() => setChapterId(undefined)}>
                  <ArrowLeft size={16} />
                  返回剧情
                </Button>
              )}
              <h2>{current?.title ?? "剧情"}</h2>
              <p>{current?.summary ?? "把故事逐步变成可制作的场景与镜头"}</p>
            </div>
            <div className="plot-actions">
              {!chapterId && (
                <Button
                  onClick={() =>
                    openAI({
                      idea: "",
                      operation: "outline",
                      chapter_count: 3,
                      style: "",
                      depth: "structure",
                    })
                  }
                >
                  <Sparkles size={16} />
                  AI 生成剧情
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  setEdit({ kind: chapterId ? "scene" : "chapter" })
                }
              >
                <Plus size={16} />
                新建{chapterId ? "场景" : "章节"}
              </Button>
            </div>
          </header>
          {(chapterId ? scenes : chapters).isPending ? (
            <p role="status">正在加载剧情…</p>
          ) : (chapterId ? scenes : chapters).isError ? (
            <div role="alert">
              剧情加载失败<Button onClick={refresh}>重试</Button>
            </div>
          ) : !items.length ? (
            <div className="plot-empty">
              <BookOpen size={36} />
              <h3>
                {chapterId ? "为这一章写下第一个场景" : "开始创作你的故事"}
              </h3>
              <p>从一个想法开始，让 AI 帮你构建剧情，或者亲自编写。</p>
              <div className="plot-actions">
                {!chapterId && (
                  <Button
                    onClick={() =>
                      openAI({
                        idea: "",
                        operation: "outline",
                        chapter_count: 3,
                        style: "",
                        depth: "structure",
                      })
                    }
                  >
                    AI 生成剧情
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    setEdit({ kind: chapterId ? "scene" : "chapter" })
                  }
                >
                  手动创建{chapterId ? "场景" : "章节"}
                </Button>
              </div>
            </div>
          ) : (
            <div className={chapterId ? "plot-scenes" : "plot-grid"}>
              {items.map((item, index) => (
                <article
                  className={`plot-card ${drag === item.id ? "is-dragging" : ""}`}
                  key={item.id}
                  onDragOver={(e) => {
                    if (drag) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag) void reorder(drag, index);
                    setDrag(undefined);
                  }}
                >
                  <div className="plot-card-top">
                    <span>
                      {chapterId ? "SCENE" : "CHAPTER"}{" "}
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      draggable={!pending}
                      aria-label="拖动排序"
                      className="plot-drag"
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", item.id);
                        setDrag(item.id);
                      }}
                      onDragEnd={() => setDrag(undefined)}
                    >
                      <GripVertical size={16} />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label="更多操作" variant="ghost">
                          <Ellipsis size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onSelect={() =>
                            setEdit({
                              kind: chapterId ? "scene" : "chapter",
                              value: item,
                            })
                          }
                        >
                          编辑名称与简介
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={pending || index === 0}
                          onSelect={() => void reorder(item.id, index - 1)}
                        >
                          <ArrowUp size={14} />
                          上移
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={pending || index === items.length - 1}
                          onSelect={() => void reorder(item.id, index + 1)}
                        >
                          <ArrowDown size={14} />
                          下移
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setDeleting({
                              kind: chapterId ? "scene" : "chapter",
                              value: item,
                            })
                          }
                        >
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <button
                    className="plot-card-open"
                    onClick={() =>
                      chapterId
                        ? setScene(item as Scene)
                        : setChapterId(item.id)
                    }
                  >
                    <h3>{item.title}</h3>
                    {"location" in item && (
                      <p>
                        {[
                          item.time_of_day,
                          item.setting === "interior"
                            ? "室内"
                            : item.setting === "exterior"
                              ? "室外"
                              : "",
                          item.location,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                    )}
                    <p className="plot-summary">
                      {item.summary || "暂无简介，点击开始编辑"}
                    </p>
                  </button>
                  {"character_ids" in item && !!item.character_ids?.length && (
                    <p className="plot-scene-people">
                      出场人物：
                      {item.character_ids
                        .map(
                          (id) =>
                            people.data?.characters.find((c) => c.id === id)
                              ?.name ??
                            (people.isPending ? "加载中" : "人物引用失效"),
                        )
                        .join("、")}
                    </p>
                  )}
                  <footer>
                    <span>
                      {"scene_count" in item
                        ? `${item.scene_count} 个场景`
                        : `${(item as Scene).blocks?.length ?? 0} 个内容块`}
                    </span>
                    <span>
                      {item.status === "completed" ? "已完成" : "草稿"}
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {!!jobs.data?.filter((j) => !j.applied && j.status !== "canceled")
        .length && (
        <section className="plot-jobs">
          <h3>AI 创作记录</h3>
          {jobs.data
            .filter((j) => !j.applied && j.status !== "canceled")
            .slice(0, 8)
            .map((job) => (
              <Button
                key={job.id}
                variant="outline"
                onClick={() => openJob(job)}
              >
                {job.request.operation === "outline" ? "剧情生成" : "场景辅助"}{" "}
                ·{" "}
                {
                  {
                    queued: "排队中",
                    running: "生成中",
                    succeeded: "查看预览",
                    failed: "失败，查看详情",
                    canceled: "已放弃",
                  }[job.status]
                }
              </Button>
            ))}
        </section>
      )}
      {edit && (
        <EditDialog
          key={edit.value?.id ?? "new"}
          kind={edit.kind}
          value={edit.value}
          pending={pending}
          error={error}
          close={() => setEdit(undefined)}
          save={async (value) => {
            const path = edit.value
              ? `/${edit.kind === "chapter" ? "chapters" : "scenes"}/${edit.value.id}`
              : edit.kind === "chapter"
                ? "/chapters"
                : `/chapters/${chapterId}/scenes`;
            if (
              await mutate(() =>
                write(root + path, edit.value ? "PATCH" : "POST", {
                  ...edit.value,
                  ...value,
                  ...(edit.value
                    ? { expected_version: edit.value.version }
                    : {}),
                }),
              )
            )
              setEdit(undefined);
          }}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>
            删除{deleting?.kind === "chapter" ? "章节" : "场景"}？
          </DialogTitle>
          <DialogDescription>
            {deleting?.kind === "chapter"
              ? "同时删除本章所有场景和正文，无法撤销。"
              : "删除此场景及其正文，无法撤销。"}
          </DialogDescription>
          <Button
            variant="outline"
            onClick={() => setDeleting(undefined)}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (deleting)
                void mutate(() =>
                  write(
                    root +
                      `/${deleting.kind === "chapter" ? "chapters" : "scenes"}/${deleting.value.id}?expected_version=${deleting.value.version}`,
                    "DELETE",
                  ),
                ).then((ok) => {
                  if (ok) setDeleting(undefined);
                });
            }}
          >
            确认删除
          </Button>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
      {ai && (
        <AIStoryDialog
          key={jobId ?? "new"}
          root={root}
          request={ai}
          job={jobs.data?.find((j) => j.id === jobId)}
          onClose={() => setAI(undefined)}
          onRefresh={(job) => {
            if (job) setJobId(job.id);
            void jobs.refetch();
          }}
          onApplied={() => {
            refresh();
            if (scene)
              void read<Scene>(root + `/scenes/${scene.id}`)
                .then(setScene)
                .catch((e) => setError(message(e)));
          }}
        />
      )}
    </div>
  );
}
function EditDialog({
  kind,
  value,
  pending,
  error,
  close,
  save,
}: {
  kind: string;
  value?: Chapter | Scene;
  pending: boolean;
  error: string;
  close: () => void;
  save: (v: {
    title: string;
    summary: string;
    status: "draft" | "completed";
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(value?.title ?? ""),
    [summary, setSummary] = useState(value?.summary ?? ""),
    [status, setStatus] = useState<"draft" | "completed">(
      value?.status ?? "draft",
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent className="plot-dialog">
        <DialogTitle>
          {value ? "编辑" : "新建"}
          {kind === "chapter" ? "章节" : "场景"}
        </DialogTitle>
        <DialogDescription>名称与简介可以随时调整。</DialogDescription>
        <form
          className="plot-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ title, summary, status });
          }}
        >
          <label>
            名称
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            简介
            <textarea
              maxLength={4000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <Select
            id="plot-edit-status"
            value={status}
            label="编辑状态"
            options={[
              { value: "draft", label: "草稿" },
              { value: "completed", label: "已完成" },
            ]}
            onChange={(value) => setStatus(value as typeof status)}
          />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={pending || !title.trim()}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
