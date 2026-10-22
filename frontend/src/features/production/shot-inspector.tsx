import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { graph } from "../character-graph/api";
import {
  read,
  mediaUrl,
  type Shot,
  type Scene,
  type CharacterImages,
  type ImageChoice,
  root,
} from "./api";
export function ShotInspector({
  projectId,
  storyId,
  shot,
  scene,
  onChange,
  onScene,
  onPrompt,
  disabled,
}: {
  projectId: string;
  storyId: string;
  shot: Shot;
  scene: Scene;
  onChange: (patch: Partial<Shot>) => void;
  onScene: (patch: Partial<Scene>) => void;
  onPrompt: () => void;
  disabled: boolean;
}) {
  const people = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "graph"],
    queryFn: ({ signal }) => graph(projectId, storyId, signal),
  });
  const images = useQuery({
    queryKey: [
      "projects",
      projectId,
      "stories",
      storyId,
      "character-images",
      shot.reference_character_id,
    ],
    queryFn: ({ signal }) =>
      read<CharacterImages>(
        `/api/v1/projects/${projectId}/stories/${storyId}/characters/${shot.reference_character_id}/images`,
        signal,
      ),
    enabled: !!shot.reference_character_id,
  });
  const assets = useQuery({
    queryKey: ["projects", projectId, "production-images"],
    queryFn: ({ signal }) =>
      read<ImageChoice[]>(root(projectId) + "/images", signal),
  });
  const locked = disabled || shot.confirmed;
  return (
    <div className="production-inspector-form">
      <h2>镜头配置</h2>
      <p className="text-muted">
        {shot.confirmed
          ? "已确认 · 取消确认后可修改"
          : "草稿 · 保存后确认才可生成"}
      </p>
      <fieldset disabled={disabled}>
        <label className="production-check">
          <input
            type="checkbox"
            checked={shot.confirmed ?? false}
            onChange={(e) => onChange({ confirmed: e.target.checked })}
          />
          确认此镜头
        </label>
      </fieldset>
      <fieldset disabled={locked}>
        <details>
          <summary>场景设置</summary>
          <label>
            场景名称
            <input
              value={scene.title}
              onChange={(e) => onScene({ title: e.target.value })}
              maxLength={120}
            />
          </label>
          <label>
            场景环境
            <textarea
              value={scene.description}
              onChange={(e) => onScene({ description: e.target.value })}
              maxLength={2000}
            />
          </label>
          <Select
            id="scene-setting"
            label="内外景"
            disabled={locked}
            value={scene.setting ?? ""}
            onChange={(v) => onScene({ setting: v as Scene["setting"] })}
            options={[
              { value: "", label: "未指定" },
              { value: "interior", label: "内景" },
              { value: "exterior", label: "外景" },
            ]}
          />
          <label>
            时间
            <input
              value={scene.time_of_day}
              onChange={(e) => onScene({ time_of_day: e.target.value })}
              maxLength={100}
            />
          </label>
        </details>
        <label>
          画面描述
          <textarea
            rows={3}
            value={shot.description}
            maxLength={2000}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </label>
        <label>
          人物动作
          <textarea
            rows={2}
            value={shot.action}
            maxLength={600}
            onChange={(e) => onChange({ action: e.target.value })}
          />
        </label>
        <label>
          时长（秒）
          <input
            type="number"
            min={0.1}
            step={0.1}
            max={120}
            value={shot.duration}
            onChange={(e) => onChange({ duration: Number(e.target.value) })}
          />
        </label>
        <details>
          <summary>高级设置 · 摄影与原文</summary>
          {(
            [
              "description",
              "script_excerpt",
              "framing",
              "angle",
              "movement",
              "action",
              "emotion",
              "environment",
            ] as const
          ).map((key, index) =>
            key === "description" || key === "action" ? null : (
              <label key={key}>
                {
                  [
                    "镜头描述",
                    "对应剧本原文",
                    "景别",
                    "机位",
                    "摄影机运动",
                    "人物动作",
                    "情绪",
                    "环境细节",
                  ][index]
                }
                <textarea
                  rows={2}
                  value={shot[key]}
                  onChange={(e) => onChange({ [key]: e.target.value })}
                  maxLength={
                    key === "script_excerpt"
                      ? 3000
                      : key === "emotion"
                        ? 300
                        : ["action", "environment"].includes(key)
                          ? 600
                          : 100
                  }
                />
              </label>
            ),
          )}
        </details>
        <details>
          <summary>出场人物</summary>
          {people.isError && <p role="alert">人物读取失败</p>}
          {people.data?.characters.map((person) => (
            <label className="production-check" key={person.id}>
              <input
                type="checkbox"
                checked={shot.character_ids?.includes(person.id) ?? false}
                onChange={(e) => {
                  const ids = e.target.checked
                    ? [...(shot.character_ids ?? []), person.id]
                    : (shot.character_ids ?? []).filter(
                        (id) => id !== person.id,
                      );
                  onChange({
                    character_ids: ids,
                    ...(!ids.includes(shot.reference_character_id ?? "")
                      ? {
                          reference_character_id: null,
                          character_image_id: null,
                        }
                      : {}),
                  });
                }}
              />
              {person.name}
            </label>
          ))}
        </details>
        <details>
          <summary>生成参考</summary>
          <p className="text-muted">
            当前适配器使用单张参考图或首帧；多个角色的形象一致性无法保证。
          </p>
          <Select
            id="reference-person"
            disabled={locked}
            label="参考人物"
            value={shot.reference_character_id ?? ""}
            onChange={(v) =>
              onChange({
                reference_character_id: v || null,
                character_image_id: null,
              })
            }
            options={[
              { value: "", label: "不使用人物参考" },
              ...(people.data?.characters ?? [])
                .filter((p) => shot.character_ids?.includes(p.id))
                .map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          {!!shot.reference_character_id && (
            <div className="production-reference-grid">
              {images.isError ? (
                <p role="alert">参考形象加载失败</p>
              ) : images.isPending ? (
                <p>正在加载…</p>
              ) : !images.data?.images.length ? (
                <p>此人物暂无参考图片</p>
              ) : (
                images.data.images.map((image) => (
                  <button
                    type="button"
                    aria-label={`使用${image.is_primary ? "主要" : "候选"}形象`}
                    aria-pressed={shot.character_image_id === image.id}
                    key={image.id}
                    onClick={() =>
                      onChange({
                        character_image_id: image.id,
                        reference_asset_id: null,
                        reference_upload_id: null,
                      })
                    }
                  >
                    <img src={image.image_url} alt="人物参考" loading="lazy" />
                    {image.is_primary && <small>主形象</small>}
                  </button>
                ))
              )}
            </div>
          )}
          <h3>项目图片</h3>
          <Select
            id="reference-asset"
            disabled={locked}
            label="已有项目图片"
            value={shot.reference_asset_id ?? ""}
            onChange={(v) =>
              onChange({
                reference_asset_id: v || null,
                reference_upload_id: null,
                character_image_id: null,
                reference_character_id: null,
              })
            }
            options={[
              { value: "", label: "不使用项目图片" },
              ...(assets.data ?? []).map((a, i) => ({
                value: a.id,
                label: `图片 ${i + 1} · ${new Date(a.created_at).toLocaleDateString()}`,
              })),
            ]}
          />
          {shot.reference_asset_id && (
            <img
              className="production-reference-preview"
              src={mediaUrl(projectId, shot.reference_asset_id)}
              alt="已选项目图片"
            />
          )}
        </details>
        <details>
          <summary>最终生成描述</summary>
          <Button type="button" variant="outline" onClick={onPrompt}>
            根据镜头构建描述
          </Button>
          <p className="text-muted">
            只在主动点击时填入，不覆盖已编辑内容。当前模型不支持独立负面提示词和尾帧。
          </p>
          <textarea
            aria-label="最终生成描述"
            rows={6}
            value={shot.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            maxLength={800}
          />
        </details>
      </fieldset>
    </div>
  );
}
