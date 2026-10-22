import { useState, useEffect, type RefObject } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { graph } from "../character-graph/api";
import { useSceneDraft } from "./use-scene-draft";
import type { Block, Generate, Scene } from "./api";

export function SceneEditor({
  root,
  projectId,
  storyId,
  scene,
  onBack,
  onSaved,
  onAI,
  saveRef,
}: {
  saveRef: RefObject<(() => Promise<boolean>) | null>;
  root: string;
  projectId: string;
  storyId: string;
  scene: Scene;
  onBack: () => void;
  onSaved: () => void;
  onAI: (request: Generate) => void;
}) {
  const editor = useSceneDraft(root, scene, onSaved);
  useEffect(() => {
    saveRef.current = editor.flush;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, editor.flush]);
  const { draft, change } = editor;
  const characters = useQuery({
    queryKey: ["character-graph", projectId, storyId],
    queryFn: ({ signal }) => graph(projectId, storyId, signal),
    refetchOnWindowFocus: true,
  });
  const [showInfo, setShowInfo] = useState(() =>
    typeof matchMedia === "function"
      ? matchMedia("(min-width: 761px)").matches
      : true,
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const blocks = draft.blocks ?? [];
  const people = characters.data?.characters ?? [];
  const update = (id: string, patch: Partial<Block>) =>
    change({
      ...draft,
      blocks: blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  const add = (type: Block["type"]) =>
    change({
      ...draft,
      blocks: [
        ...blocks,
        {
          id: crypto.randomUUID(),
          type,
          content: "",
          character_id: type === "dialogue" ? people[0]?.id : null,
        },
      ],
    });
  const move = (index: number, delta: number) => {
    const next = [...blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    change({ ...draft, blocks: next });
  };
  const assist = async (operation: Generate["operation"]) => {
    if (operation !== "continue" && !selected) return;
    if (await editor.flush())
      onAI({
        idea: "根据当前场景和人物设定完成此操作",
        chapter_count: 3,
        style: "",
        depth: "structure",
        operation,
        scene_id: scene.id,
        block_id: operation === "continue" ? null : selected,
        expected_version: editor.version.current,
      });
  };
  return (
    <div className="plot-editor">
      <header className="plot-heading">
        <Button
          variant="ghost"
          onClick={() =>
            void editor.flush().then((ok) => {
              if (ok) onBack();
            })
          }
        >
          <ArrowLeft size={16} />
          返回章节
        </Button>
        <div role="status">
          {
            {
              saved: "已保存",
              dirty: "等待保存",
              saving: "正在保存…",
              error: "保存失败",
            }[editor.state]
          }
        </div>
        <Button variant="outline" onClick={() => void editor.flush()}>
          保存
        </Button>
      </header>
      {editor.error && (
        <div role="alert" className="plot-error">
          {editor.error}
          。草稿已保留，请重试；版本冲突时请先复制正文备份再重新载入。
        </div>
      )}
      <input
        className="plot-title-input"
        aria-label="场景标题"
        value={draft.title}
        onChange={(e) => change({ ...draft, title: e.target.value })}
      />
      <div className="plot-editor-layout">
        <main>
          <textarea
            aria-label="场景简介"
            placeholder="场景简介"
            value={draft.summary ?? ""}
            onChange={(e) => change({ ...draft, summary: e.target.value })}
          />
          <div className="plot-ai-actions">
            <Button variant="ghost" onClick={() => void assist("continue")}>
              <Sparkles size={15} />
              AI 续写
            </Button>
            {selected && (
              <>
                <Button variant="ghost" onClick={() => void assist("polish")}>
                  润色选中块
                </Button>
                <Button variant="ghost" onClick={() => void assist("action")}>
                  丰富动作
                </Button>
                <Button variant="ghost" onClick={() => void assist("dialogue")}>
                  生成对白
                </Button>
                <Button variant="ghost" onClick={() => void assist("rewrite")}>
                  重写选中块
                </Button>
              </>
            )}
          </div>
          {blocks.map((block, index) => (
            <section
              className={`plot-block ${selected === block.id ? "is-selected" : ""}`}
              key={block.id}
              onFocus={() => setSelected(block.id)}
            >
              <div className="plot-block-head">
                <Select
                  id={`type-${block.id}`}
                  value={block.type}
                  label="内容块类型"
                  options={[
                    { value: "action", label: "动作描述" },
                    { value: "dialogue", label: "人物对白" },
                    { value: "narration", label: "旁白" },
                  ]}
                  onChange={(type) =>
                    update(block.id, {
                      type: type as Block["type"],
                      character_id:
                        type === "dialogue"
                          ? (block.character_id ?? people[0]?.id)
                          : null,
                    })
                  }
                />
                {block.type === "dialogue" && (
                  <Select
                    id={`person-${block.id}`}
                    label="对白人物"
                    value={block.character_id ?? ""}
                    placeholder="请选择人物"
                    options={[
                      ...people.map((c) => ({ value: c.id, label: c.name })),
                      ...(block.character_id &&
                      !people.some((c) => c.id === block.character_id)
                        ? [
                            {
                              value: block.character_id,
                              label: "人物已删除（引用失效）",
                            },
                          ]
                        : []),
                    ]}
                    onChange={(character_id) =>
                      update(block.id, { character_id })
                    }
                  />
                )}
                <Button
                  aria-label="上移内容块"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  aria-label="下移内容块"
                  variant="ghost"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} />
                </Button>
                <Button
                  aria-label="删除内容块"
                  variant="ghost"
                  onClick={() =>
                    change({
                      ...draft,
                      blocks: blocks.filter((b) => b.id !== block.id),
                    })
                  }
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <textarea
                aria-label={`内容块 ${index + 1}`}
                placeholder="写下剧情，输入 / 选择内容类型"
                value={block.content}
                onChange={(e) => update(block.id, { content: e.target.value })}
              />
              {block.content === "/" && (
                <div className="plot-inline-menu">
                  {(["action", "dialogue", "narration"] as const).map(
                    (type, i) => (
                      <Button
                        key={type}
                        variant="ghost"
                        disabled={type === "dialogue" && !people.length}
                        onClick={() =>
                          update(block.id, {
                            type,
                            content: "",
                            character_id:
                              type === "dialogue" ? people[0]?.id : null,
                          })
                        }
                      >
                        {["动作", "对白", "旁白"][i]}
                      </Button>
                    ),
                  )}
                </div>
              )}
            </section>
          ))}
          <div className="plot-add-block">
            {(["action", "dialogue", "narration"] as const).map((type, i) => (
              <Button
                key={type}
                variant="outline"
                disabled={type === "dialogue" && !people.length}
                onClick={() => add(type)}
              >
                <Plus size={14} />
                {["动作", "对白", "旁白"][i]}
              </Button>
            ))}
          </div>
        </main>
        <aside>
          <details
            open={showInfo}
            onToggle={(event) => setShowInfo(event.currentTarget.open)}
          >
            <summary>场景信息与出场人物</summary>
            <div className="plot-info-fields">
              <label>
                地点
                <input
                  value={draft.location ?? ""}
                  onChange={(e) =>
                    change({ ...draft, location: e.target.value })
                  }
                />
              </label>
              <label>
                时间
                <input
                  value={draft.time_of_day ?? ""}
                  onChange={(e) =>
                    change({ ...draft, time_of_day: e.target.value })
                  }
                />
              </label>
              <Select
                id="scene-setting"
                label="内外景"
                value={draft.setting ?? ""}
                options={[
                  { value: "", label: "未设置内外景" },
                  { value: "interior", label: "室内" },
                  { value: "exterior", label: "室外" },
                ]}
                onChange={(setting) =>
                  change({ ...draft, setting: setting as Scene["setting"] })
                }
              />
              <Select
                id="scene-status"
                label="场景状态"
                value={draft.status ?? "draft"}
                options={[
                  { value: "draft", label: "草稿" },
                  { value: "completed", label: "已完成" },
                ]}
                onChange={(status) =>
                  change({ ...draft, status: status as Scene["status"] })
                }
              />
              <h3>出场人物</h3>
              {characters.isError && (
                <p role="alert">
                  人物加载失败
                  <Button
                    variant="ghost"
                    onClick={() => void characters.refetch()}
                  >
                    重试
                  </Button>
                </p>
              )}
              {!characters.isPending &&
              !characters.isError &&
              !people.length ? (
                <Link
                  to={`/projects/${projectId}/stories/${storyId}/relations`}
                >
                  前往人物关系创建人物
                </Link>
              ) : (
                <>
                  <input
                    aria-label="搜索人物"
                    placeholder="搜索人物"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {people
                    .filter((c) => c.name.includes(search))
                    .map((c) => (
                      <label className="plot-person" key={c.id}>
                        <input
                          type="checkbox"
                          checked={(draft.character_ids ?? []).includes(c.id)}
                          onChange={(e) =>
                            change({
                              ...draft,
                              character_ids: e.target.checked
                                ? [...(draft.character_ids ?? []), c.id]
                                : (draft.character_ids ?? []).filter(
                                    (id) => id !== c.id,
                                  ),
                            })
                          }
                        />
                        {c.avatar_url && <img src={c.avatar_url} alt="" />}
                        {c.name}
                      </label>
                    ))}
                </>
              )}
              {(draft.character_ids ?? [])
                .filter((id) => !people.some((c) => c.id === id))
                .map((id) => (
                  <div key={id}>
                    人物引用失效
                    <Button
                      variant="ghost"
                      onClick={() =>
                        change({
                          ...draft,
                          character_ids: draft.character_ids?.filter(
                            (c) => c !== id,
                          ),
                        })
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
