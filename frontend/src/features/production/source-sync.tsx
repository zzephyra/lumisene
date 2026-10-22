import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  read,
  root,
  change,
  message,
  type Source,
  type Impact,
  type Production,
  type Selection,
} from "./api";
import { sourceChapters } from "./source-panel";
import { isRecord } from "../../lib/record";
export function SourceSync({
  projectId,
  data,
  onClose,
  onSaved,
}: {
  projectId: string;
  data: Production;
  onClose: () => void;
  onSaved: (data: Production) => void;
}) {
  const path = root(projectId, data.story_id) + "/" + data.id;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selections, setSelections] = useState<Selection[]>(() => {
    const stored = data.snapshot.selection;
    if (Array.isArray(stored))
      return stored.filter(isRecord).map((s) => ({
        chapter_id: String(s.chapter_id),
        scene_ids: Array.isArray(s.scene_ids) ? s.scene_ids.map(String) : null,
      }));
    return sourceChapters(data).map((c) => ({
      chapter_id: c.id,
      scene_ids: null,
    }));
  });
  const source = useQuery({
    queryKey: [path, "live-source"],
    queryFn: ({ signal }) =>
      read<Source>(root(projectId) + "/source/" + data.story_id, signal),
  });
  const impact = useQuery({
    queryKey: [path, "sync-impact"],
    queryFn: ({ signal }) => read<Impact>(path + "/source-impact", signal),
  });
  async function save() {
    if (busy || !impact.data) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await change(path + "/sync-source", "POST", {
          expected_version: data.version,
          fingerprint: impact.data.fingerprint,
          selections,
        }),
      );
      onClose();
    } catch (e) {
      setError(message(e));
      void impact.refetch();
      void source.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="production-wizard">
        <DialogTitle>制作范围与剧本同步</DialogTitle>
        <DialogDescription>
          勾选章节并调整顺序。只更新源快照，已有镜头、人工编辑和生成历史均保留；移出范围的镜头需要人工复核。
        </DialogDescription>
        {source.isPending || impact.isPending ? (
          <div className="production-skeleton" />
        ) : source.isError || impact.isError ? (
          <Button
            onClick={() => {
              void source.refetch();
              void impact.refetch();
            }}
          >
            载入失败，重试
          </Button>
        ) : (
          <div className="production-scope">
            <div>
              {source.data?.chapters.map((c) => {
                const selected = selections.find((s) => s.chapter_id === c.id);
                return (
                  <article key={c.id}>
                    <label className="production-check">
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={(e) =>
                          setSelections(
                            e.target.checked
                              ? [
                                  ...selections,
                                  { chapter_id: c.id, scene_ids: null },
                                ]
                              : selections.filter((s) => s.chapter_id !== c.id),
                          )
                        }
                      />
                      {c.title}
                    </label>
                    {selected && (
                      <details>
                        <summary>场景范围</summary>
                        {c.scenes.map((scene) => (
                          <label className="production-check" key={scene.id}>
                            <input
                              type="checkbox"
                              checked={
                                selected.scene_ids == null ||
                                selected.scene_ids.includes(scene.id)
                              }
                              onChange={(e) => {
                                const old =
                                  selected.scene_ids ??
                                  c.scenes.map((s) => s.id);
                                setSelections(
                                  selections.map((s) =>
                                    s.chapter_id === c.id
                                      ? {
                                          ...s,
                                          scene_ids: e.target.checked
                                            ? [...old, scene.id]
                                            : old.filter(
                                                (id) => id !== scene.id,
                                              ),
                                        }
                                      : s,
                                  ),
                                );
                              }}
                            />
                            {scene.title}
                          </label>
                        ))}
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
            <aside>
              <h3>制作顺序</h3>
              {selections.map((s, i) => (
                <div className="production-scope-order" key={s.chapter_id}>
                  <span>
                    {source.data?.chapters.find((c) => c.id === s.chapter_id)
                      ?.title ?? "已删除章节（请移除）"}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...selections];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setSelections(next);
                    }}
                  >
                    上移
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setSelections(
                        selections.filter((v) => v.chapter_id !== s.chapter_id),
                      )
                    }
                  >
                    移除
                  </Button>
                </div>
              ))}
              <p>
                {impact.data?.changed_chapter_ids.length ?? 0} 个源章节变化，
                {impact.data?.affected_shot_ids.length ?? 0} 个镜头受影响。
              </p>
              <p>
                修改范围或顺序后，请复核所有镜头的叙事衔接，不会自动删除或重新生成。
              </p>
            </aside>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <Button
          disabled={
            busy ||
            !source.data ||
            !impact.data ||
            !selections.length ||
            selections.some(
              (s) =>
                s.scene_ids?.length === 0 ||
                !source.data?.chapters.some((c) => c.id === s.chapter_id),
            )
          }
          onClick={() => void save()}
        >
          {busy ? "正在同步…" : "确认范围并同步快照"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
