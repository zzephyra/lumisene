import { useEffect, useState } from "react";
import {
  Copy,
  Scissors,
  Film,
  Trash2,
  ArrowUp,
  ArrowDown,
  Merge,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { reviewShots } from "./shot-review";
import { mediaUrl, type Board, type Shot } from "./api";

/** New editorial shots never silently adopt a source shot's generated versions. */
export function duplicateShot(board: Board, id: string, split = false): Board {
  const copy = structuredClone(board);
  const scene = copy.scenes?.find((s) => s.shots?.some((s) => s.id === id));
  if (!scene?.shots) return board;
  const index = scene.shots.findIndex((s) => s.id === id),
    original = scene.shots![index];
  const next: Shot = {
    ...original,
    id: crypto.randomUUID(),
    confirmed: false,
    selected_image_id: null,
    selected_video_id: null,
    generation_duration: null,
  };
  if (split) {
    const duration = original.duration;
    original.duration = Math.round(duration * 50) / 100;
    next.duration = Math.round((duration - original.duration) * 100) / 100;
    original.confirmed = false;
    original.generation_duration = null;
    next.description += "（后半段，待调整）";
  } else next.description += "（副本）";
  scene.shots.splice(index + 1, 0, next);
  return copy;
}
export function Storyboard({
  projectId,
  board,
  selected,
  onSelect,
  onEdit,
  disabled,
  maxDuration,
  onOptimize,
}: {
  projectId: string;
  board: Board;
  selected?: string;
  onSelect: (id: string) => void;
  onEdit: (board: Board) => void;
  disabled: boolean;
  maxDuration?: number | null;
  onOptimize?: (id: string) => void;
}) {
  const reviews = reviewShots(board);
  const [checked, setChecked] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ before: Board; after: Board } | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(id);
  }, [undo]);
  function remove(ids: string[]) {
    const next = {
      ...board,
      scenes: (board.scenes ?? []).map((s) => ({
        ...s,
        shots: (s.shots ?? []).filter((x) => !ids.includes(x.id!)),
      })),
    };
    setUndo({ before: board, after: next });
    onEdit(next);
    setChecked([]);
    setFeedback("已从制作计划移除，原始资产保留");
  }
  function move(id: string, target: string) {
    const next = structuredClone(board);
    const scene = next.scenes?.find((s) => s.shots?.some((x) => x.id === id));
    if (!scene?.shots || !scene.shots.some((x) => x.id === target)) return;
    const from = scene.shots.findIndex((x) => x.id === id),
      to = scene.shots.findIndex((x) => x.id === target);
    scene.shots.splice(to, 0, scene.shots.splice(from, 1)[0]);
    onEdit(next);
  }

  const [layout, setLayout] = useState<"grid" | "list">("grid");
  return (
    <>
      <div className="production-preview-heading">
        <h2>分镜工作区</h2>
        <div>
          {(["grid", "list"] as const).map((v) => (
            <Button
              key={v}
              variant="ghost"
              aria-pressed={layout === v}
              onClick={() => setLayout(v)}
            >
              {v === "grid" ? "网格" : "列表"}
            </Button>
          ))}
        </div>
      </div>
      {!!reviews.length && (
        <details className="production-review">
          <summary>发现 {reviews.length} 组相似镜头</summary>
          {reviews.map((r) => (
            <div key={r.key}>
              <p>
                镜头 {r.firstNumber}「{r.first.description.slice(0, 24)}」与镜头{" "}
                {r.secondNumber}「{r.second.description.slice(0, 24)}
                」内容较接近，建议检查动作与剧情推进。
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  onSelect(r.first.id!);
                  document
                    .getElementById(`shot-${r.first.id}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" });
                }}
              >
                查看镜头
              </Button>
              {onOptimize && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onOptimize(r.second.id!)}
                >
                  AI 优化
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onEdit({
                    ...board,
                    dismissed_reviews: [
                      ...(board.dismissed_reviews ?? []),
                      r.key,
                    ].slice(-100),
                  })
                }
              >
                保留原样
              </Button>
            </div>
          ))}
        </details>
      )}
      {!!checked.length && (
        <div className="production-feedback">
          <span>已选 {checked.length} 个镜头</span>
          <Button
            disabled={disabled}
            variant="ghost"
            onClick={() => remove(checked)}
          >
            移除所选镜头（可撤销）
          </Button>
          <Button variant="ghost" onClick={() => setChecked([])}>
            取消选择
          </Button>
        </div>
      )}
      {feedback && (
        <p role="status">
          {feedback}{" "}
          {undo && (
            <Button
              variant="ghost"
              onClick={() => {
                const restored = structuredClone(board);
                const remaining = new Set(
                  undo.after.scenes?.flatMap(
                    (c) => c.shots?.map((s) => s.id) ?? [],
                  ),
                );
                for (const oldScene of undo.before.scenes ?? []) {
                  const scene = restored.scenes?.find(
                    (c) => c.id === oldScene.id,
                  );
                  if (!scene?.shots) continue;
                  oldScene.shots?.forEach((shot, index) => {
                    if (
                      !remaining.has(shot.id) &&
                      !scene.shots!.some((s) => s.id === shot.id)
                    )
                      scene.shots!.splice(
                        Math.min(index, scene.shots!.length),
                        0,
                        shot,
                      );
                  });
                }
                onEdit(restored);
                setUndo(null);
                setFeedback("已撤销移除");
              }}
            >
              撤销
            </Button>
          )}
        </p>
      )}
      {board.adaptation_summary && (
        <details open className="production-adaptation">
          <summary>影视化改编</summary>
          <p>{board.adaptation_summary}</p>
        </details>
      )}
      {!!board.risks?.length && (
        <details className="production-adaptation">
          <summary>{board.risks.length} 项规划提示</summary>
          <ul>
            {board.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {!board.scenes?.some((s) => s.shots?.length) && (
        <div className="production-empty">
          <Film />
          <h3>还没有分镜</h3>
          <p>使用 AI 规划，或手动添加场景与镜头。</p>
        </div>
      )}
      {board.scenes?.map((scene) => (
        <details open key={scene.id} className="production-board-scene">
          <summary>
            {scene.title} · {scene.shots!.length} 个镜头
          </summary>
          <p className="text-muted">{scene.description}</p>
          <div className={`production-board-${layout}`}>
            {scene.shots?.map((shot, index) => (
              <article
                id={`shot-${shot.id}`}
                key={shot.id}
                data-selected={selected === shot.id}
                draggable={!disabled}
                onDragStart={() => setDragged(shot.id!)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!disabled && dragged) move(dragged, shot.id!);
                  setDragged(null);
                }}
              >
                <label className="production-shot-check">
                  <input
                    type="checkbox"
                    aria-label={`选择镜头 ${index + 1}`}
                    checked={checked.includes(shot.id!)}
                    onChange={(e) =>
                      setChecked(
                        e.target.checked
                          ? [...checked, shot.id!]
                          : checked.filter((id) => id !== shot.id!),
                      )
                    }
                  />
                  选择
                </label>
                <button
                  className="production-board-select"
                  onClick={() => onSelect(shot.id!)}
                >
                  <div className="production-board-image">
                    {shot.selected_image_id ? (
                      <img
                        src={mediaUrl(projectId, shot.selected_image_id)}
                        alt={shot.description}
                        loading="lazy"
                      />
                    ) : (
                      <Film size={28} />
                    )}
                  </div>
                  <div>
                    <strong>
                      {(board.scenes ?? [])
                        .slice(0, (board.scenes ?? []).indexOf(scene))
                        .reduce((n, c) => n + (c.shots?.length ?? 0), 0) +
                        index +
                        1}
                      . {shot.description || "未命名镜头"}
                    </strong>
                    <p>{shot.script_excerpt || "尚未填写原文片段"}</p>
                    <small>
                      {shot.duration}s 计划 ·{" "}
                      {shot.selected_video_id
                        ? "已采用视频"
                        : shot.confirmed
                          ? "已确认"
                          : "待确认"}{" "}
                      · {shot.character_ids?.length ?? 0} 位人物
                    </small>
                  </div>
                </button>
                <footer>
                  <Button variant="ghost" onClick={() => onSelect(shot.id!)}>
                    编辑
                  </Button>
                  <details className="production-shot-actions">
                    <summary aria-label="镜头更多操作">···</summary>
                    <div>
                      <Button
                        disabled={disabled}
                        variant="ghost"
                        aria-label="复制镜头"
                        onClick={() => onEdit(duplicateShot(board, shot.id!))}
                      >
                        <Copy size={14} />
                        复制
                      </Button>
                      <Button
                        disabled={disabled || shot.duration < 0.2}
                        variant="ghost"
                        aria-label="拆分镜头"
                        onClick={() =>
                          onEdit(duplicateShot(board, shot.id!, true))
                        }
                      >
                        <Scissors size={14} />
                        拆分
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={disabled}
                        aria-label="删除镜头"
                        onClick={() => remove([shot.id!])}
                      >
                        <Trash2 size={14} />
                        删除
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={disabled || !canMergeShots(board, shot.id!)}
                        onClick={() => {
                          const following = scene.shots![index + 1];
                          if (
                            maxDuration &&
                            shot.duration + following.duration > maxDuration
                          ) {
                            setFeedback(
                              `合并后时长过长，请保留为两个连续镜头，或先拆分调整时长。`,
                            );
                            return;
                          }
                          onEdit(mergeShots(board, shot.id!));
                        }}
                      >
                        <Merge size={14} />
                        合并下一镜
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="镜头前移"
                        disabled={disabled || index === 0}
                        onClick={() =>
                          move(shot.id!, scene.shots![index - 1].id!)
                        }
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="镜头后移"
                        disabled={disabled || index === scene.shots!.length - 1}
                        onClick={() =>
                          move(shot.id!, scene.shots![index + 1].id!)
                        }
                      >
                        <ArrowDown size={14} />
                      </Button>
                    </div>
                  </details>
                </footer>
              </article>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

export function mergeShots(board: Board, firstId: string): Board {
  const copy = structuredClone(board),
    scene = copy.scenes?.find((s) => s.shots?.some((s) => s.id === firstId));
  if (!scene?.shots) return board;
  const index = scene.shots.findIndex((s) => s.id === firstId),
    a = scene.shots![index],
    b = scene.shots![index + 1];
  if (
    !b ||
    a.source_chapter_id !== b.source_chapter_id ||
    a.source_scene_id !== b.source_scene_id ||
    a.duration + b.duration > 120
  )
    return board;
  const description = a.description + "；" + b.description,
    dialogue = [a.dialogue, b.dialogue].filter(Boolean).join("\n"),
    excerpt = [a.script_excerpt, b.script_excerpt].filter(Boolean).join("\n");
  if (
    description.length > 2000 ||
    dialogue.length > 3000 ||
    excerpt.length > 3000
  )
    return board;
  scene.shots.splice(index, 2, {
    ...a,
    id: crypto.randomUUID(),
    description,
    dialogue,
    script_excerpt: excerpt,
    duration: a.duration + b.duration,
    character_ids: [
      ...new Set([...(a.character_ids ?? []), ...(b.character_ids ?? [])]),
    ],
    confirmed: false,
    selected_image_id: null,
    selected_video_id: null,
    generation_duration: null,
    prompt: "",
  });
  return copy;
}

export function canMergeShots(board: Board, id: string): boolean {
  const scene = board.scenes?.find((s) => s.shots?.some((s) => s.id === id));
  if (!scene?.shots) return false;
  const index = scene.shots.findIndex((s) => s.id === id),
    a = scene.shots![index],
    b = scene.shots![index + 1];
  return (
    !!b &&
    a.source_chapter_id === b.source_chapter_id &&
    a.source_scene_id === b.source_scene_id &&
    a.duration + b.duration <= 120 &&
    a.description.length + b.description.length + 1 <= 2000 &&
    a.dialogue.length + b.dialogue.length + 1 <= 3000 &&
    a.script_excerpt.length + b.script_excerpt.length + 1 <= 3000
  );
}
