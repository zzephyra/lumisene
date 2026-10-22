import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Clapperboard } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { VideoPlayer } from "../../components/media/video-player";
import {
  change,
  message,
  read,
  root,
  active,
  statusName,
  mediaUrl,
  type Production,
} from "./api";
import { sourceChapters } from "./source-panel";
import { CreateProductionWizard } from "./create-wizard";
import "./production.css";
export function StoryFilms({
  projectId,
  storyId,
  onCreate,
}: {
  projectId: string;
  storyId: string;
  onCreate: () => void;
}) {
  const [copying, setCopying] = useState(false),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all"),
    [preview, setPreview] = useState<{
      production: Production;
      asset: string;
    } | null>(null),
    [resume, setResume] = useState<Production | null>(null);
  const query = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "productions"],
    queryFn: ({ signal }) =>
      read<Production[]>(root(projectId, storyId), signal),
    refetchInterval: (q) =>
      q.state.data?.some((p) => p.runs.some((r) => active(r.status)))
        ? 3000
        : false,
  });
  async function copySettings(p: Production) {
    if (copying) return;
    setCopying(true);
    setError("");
    try {
      const copied = await change(
        root(projectId, storyId) + "/" + p.id + "/copy-settings",
        "POST",
      );
      await query.refetch();
      setResume(copied);
    } catch (e) {
      setError(message(e));
    } finally {
      setCopying(false);
    }
  }
  const state = (p: Production) =>
    p.runs.some((r) => active(r.status))
      ? "running"
      : p.runs.find((r) => r.kind === "export")?.status === "succeeded"
        ? "succeeded"
        : p.runs[0]?.status === "failed"
          ? "failed"
          : "draft";
  return (
    <section className="story-films">
      <header>
        <div>
          <h2>成片</h2>
          <p className="text-muted">
            当前故事的制作任务与最终视频，离开页面后任务继续运行。
          </p>
        </div>
        <nav>
          {[
            ["all", "全部"],
            ["succeeded", "已完成"],
            ["running", "生成中"],
            ["failed", "失败"],
          ].map(([key, label]) => (
            <Button
              key={key}
              variant="ghost"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </nav>
      </header>
      {error && <p role="alert">{error}</p>}
      {query.isPending ? (
        <div className="production-skeleton" />
      ) : query.isError ? (
        <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
      ) : !query.data?.length ? (
        <div className="production-empty">
          <Clapperboard size={36} />
          <h2>还没有生成视频</h2>
          <p>选择故事章节，开始制作你的第一部 AI 视频。</p>
          <Button onClick={onCreate}>
            <Clapperboard size={16} />
            生成视频
          </Button>
        </div>
      ) : (
        <div className="story-films-grid">
          {!query.data.some((p) => filter === "all" || state(p) === filter) && (
            <p>当前筛选下没有制作任务。</p>
          )}
          {query.data
            .filter((p) => filter === "all" || state(p) === filter)
            .map((p) => {
              const output = p.runs.find(
                  (r) =>
                    r.kind === "export" &&
                    r.status === "succeeded" &&
                    r.output_asset_ids?.length,
                ),
                asset = output?.output_asset_ids?.[0],
                currentRun =
                  p.runs.find(
                    (r) => active(r.status) && r.kind !== "execution",
                  ) ??
                  p.runs.find((r) => active(r.status)) ??
                  p.runs[0],
                completed = p.runs.filter(
                  (r) => r.kind === "video" && r.status === "succeeded",
                ).length;
              return (
                <article key={p.id}>
                  <button
                    type="button"
                    className="story-film-cover"
                    disabled={!asset}
                    onClick={() =>
                      asset && setPreview({ production: p, asset })
                    }
                  >
                    {asset ? (
                      <video
                        preload="metadata"
                        src={mediaUrl(projectId, asset)}
                        muted
                      />
                    ) : (
                      <Clapperboard size={36} />
                    )}
                  </button>
                  <div>
                    <h3>{p.title}</h3>
                    <p>
                      {sourceChapters(p)
                        .map((c) => c.title)
                        .join("、")}
                    </p>
                    <small>
                      {p.settings.aspect_ratio} · 分镜{" "}
                      {(p.board?.scenes ?? [])
                        .reduce(
                          (total, scene) =>
                            total +
                            (scene.shots ?? []).reduce(
                              (sum, shot) => sum + (shot.duration ?? 0),
                              0,
                            ),
                          0,
                        )
                        .toFixed(0)}
                      s · 目标 {p.settings.target_duration}s ·{" "}
                      {new Date(p.updated_at).toLocaleString()}
                    </small>
                    <p>
                      {state(p) === "draft" ? "制作草稿" : statusName(state(p))}{" "}
                      · 已完成 {completed} 个视频任务
                    </p>
                    {currentRun && (
                      <p>
                        当前阶段：
                        {(
                          {
                            plan: "分镜规划",
                            image: "首帧图片",
                            video: "镜头视频",
                            export: "成片合成",
                            execution: "制作调度",
                          } as Record<string, string>
                        )[currentRun.kind] ?? currentRun.kind}{" "}
                        · {statusName(currentRun.status)}
                      </p>
                    )}
                    {state(p) === "failed" && currentRun?.error && (
                      <p role="alert">
                        {currentRun.error ===
                        "The model provider request failed"
                          ? "视频供应商生成失败。已完成镜头已保留，可继续向导重试剩余镜头。"
                          : currentRun.error}
                      </p>
                    )}
                    <footer>
                      <Link
                        to={`/projects/${projectId}/stories/${storyId}/video-productions/${p.id}`}
                      >
                        编辑分镜与时间线
                      </Link>
                      <Button variant="ghost" onClick={() => setResume(p)}>
                        继续向导
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={copying}
                        onClick={() => void copySettings(p)}
                      >
                        复制制作配置
                      </Button>
                      {asset && (
                        <a href={mediaUrl(projectId, asset)} download>
                          下载视频
                        </a>
                      )}
                    </footer>
                  </div>
                </article>
              );
            })}
        </div>
      )}
      {resume && (
        <CreateProductionWizard
          projectId={projectId}
          storyId={storyId}
          storyTitle={
            resume.snapshot.story &&
            typeof resume.snapshot.story === "object" &&
            "title" in resume.snapshot.story
              ? String(resume.snapshot.story.title)
              : resume.title
          }
          initialProductionId={resume.id}
          open
          onClose={() => {
            setResume(null);
            void query.refetch();
          }}
        />
      )}
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="production-wizard">
          <DialogTitle>{preview?.production.title}</DialogTitle>
          <DialogDescription>
            最终导出版本 · 实际时长以播放器为准。
          </DialogDescription>
          {preview && (
            <>
              <VideoPlayer src={mediaUrl(projectId, preview.asset)} />
              <p>
                {sourceChapters(preview.production)
                  .map((c) => c.title)
                  .join("、")}
              </p>
              <Link
                to={`/projects/${projectId}/stories/${storyId}/video-productions/${preview.production.id}`}
              >
                查看分镜、生成版本及导出记录
              </Link>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
