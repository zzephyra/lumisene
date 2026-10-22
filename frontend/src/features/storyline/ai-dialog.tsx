import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { write, message, type Generate, type Job, type Result } from "./api";

export function AIStoryDialog({
  root,
  request,
  job,
  onClose,
  onRefresh,
  onApplied,
}: {
  root: string;
  request: Generate;
  job?: Job;
  onClose: () => void;
  onRefresh: (job?: Job) => void;
  onApplied: () => void;
}) {
  const [form, setForm] = useState(request),
    [preview, setPreview] = useState<Result | undefined>(
      job?.result ?? undefined,
    );
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const result = preview ?? job?.result;
  async function submit() {
    setPending(true);
    setError("");
    try {
      const next = await write<Job>(root + "/jobs", "POST", form, key.current);
      setPreview(undefined);
      onRefresh(next);
      key.current = crypto.randomUUID();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  async function apply() {
    if (!job || !result) return;
    setPending(true);
    try {
      await write(root + `/jobs/${job.id}/apply`, "POST", { result });
      onApplied();
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  const active = job?.status === "queued" || job?.status === "running";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="plot-dialog">
        <DialogTitle className="text-lg font-semibold">
          {request.operation === "outline" ? "AI 生成剧情" : "AI 辅助编辑"}
        </DialogTitle>
        <DialogDescription>
          生成结果先预览，确认后
          {request.operation === "outline"
            ? "追加到当前剧本，不覆盖已有章节"
            : "仅应用到选定范围"}
          。关闭弹窗后任务继续运行。
        </DialogDescription>
        {error && (
          <p role="alert" className="plot-error">
            {error}
          </p>
        )}
        {!job || job.status === "failed" || job.status === "canceled" ? (
          <div className="plot-form">
            <label>
              创作要求
              <textarea
                value={form.idea}
                maxLength={3000}
                onChange={(e) => {
                  setForm({ ...form, idea: e.target.value });
                  key.current = crypto.randomUUID();
                }}
              />
            </label>
            {request.operation === "outline" && (
              <>
                <label>
                  章节数量
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.chapter_count ?? 3}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        chapter_count: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  风格（可选）
                  <input
                    placeholder="沿用剧本介绍，或填写悬疑、爱情等"
                    value={form.style ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, style: e.target.value })
                    }
                  />
                </label>
                <Select
                  id="plot-depth"
                  side="top"
                  value={form.depth ?? "structure"}
                  label="生成深度"
                  options={[
                    { value: "outline", label: "仅生成章节大纲" },
                    { value: "structure", label: "章节及场景结构" },
                  ]}
                  onChange={(depth) =>
                    setForm({ ...form, depth: depth as Generate["depth"] })
                  }
                />
              </>
            )}
            {job?.error && <p role="alert">{job.error}</p>}
            <Button
              disabled={pending || !form.idea.trim()}
              onClick={() => void submit()}
            >
              {pending ? "正在提交…" : "开始生成"}
            </Button>
          </div>
        ) : null}
        {active && (
          <div className="plot-empty" role="status">
            <span className="plot-pulse" />
            {job.status === "queued" ? "任务排队中…" : "正在构建剧情…"}
            <p>完成后可在此预览和编辑。</p>
          </div>
        )}
        {result && job?.status === "succeeded" && (
          <div className="plot-preview">
            {(result.chapters ?? []).map((chapter, index) => (
              <section key={index}>
                <label>
                  第 {index + 1} 章
                  <input
                    value={chapter.title}
                    onChange={(e) =>
                      setPreview({
                        ...result,
                        chapters: result.chapters?.map((c, i) =>
                          i === index ? { ...c, title: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
                <textarea
                  aria-label="章节简介"
                  value={chapter.summary ?? ""}
                  onChange={(e) =>
                    setPreview({
                      ...result,
                      chapters: result.chapters?.map((c, i) =>
                        i === index ? { ...c, summary: e.target.value } : c,
                      ),
                    })
                  }
                />
                {chapter.scenes?.map((scene, si) => (
                  <label key={si}>
                    场景 {si + 1}
                    <input
                      value={scene.title}
                      onChange={(e) =>
                        setPreview({
                          ...result,
                          chapters: result.chapters?.map((c, i) =>
                            i === index
                              ? {
                                  ...c,
                                  scenes: c.scenes?.map((s, j) =>
                                    j === si
                                      ? { ...s, title: e.target.value }
                                      : s,
                                  ),
                                }
                              : c,
                          ),
                        })
                      }
                    />
                    <textarea
                      aria-label="场景简介"
                      value={scene.summary ?? ""}
                      onChange={(e) =>
                        setPreview({
                          ...result,
                          chapters: result.chapters?.map((c, i) =>
                            i === index
                              ? {
                                  ...c,
                                  scenes: c.scenes?.map((s, j) =>
                                    j === si
                                      ? { ...s, summary: e.target.value }
                                      : s,
                                  ),
                                }
                              : c,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </section>
            ))}
            {result.blocks?.map((block, index) => (
              <label key={block.id}>
                {block.type === "dialogue"
                  ? "对白"
                  : block.type === "action"
                    ? "动作"
                    : "旁白"}
                <textarea
                  value={block.content}
                  onChange={(e) =>
                    setPreview({
                      ...result,
                      blocks: result.blocks?.map((b, i) =>
                        i === index ? { ...b, content: e.target.value } : b,
                      ),
                    })
                  }
                />
              </label>
            ))}
            {!job.applied ? (
              <div className="plot-heading">
                <Button disabled={pending} onClick={() => void apply()}>
                  确认
                  {request.operation === "outline" ? "追加章节" : "应用修改"}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void submit()}
                >
                  重新生成
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    void write(root + `/jobs/${job.id}`, "DELETE")
                      .then(() => {
                        onRefresh();
                        onClose();
                      })
                      .catch((e) => setError(message(e)))
                  }
                >
                  放弃结果
                </Button>
              </div>
            ) : (
              <p>此结果已应用</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
