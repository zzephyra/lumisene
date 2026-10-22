import type { ReactNode } from "react";
import { Select } from "../../components/ui/select";
import type { Settings } from "./api";

export function SettingsField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="production-settings-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function SettingsForm({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (value: Settings) => void;
}) {
  const patch = (p: Partial<Settings>) => onChange({ ...value, ...p });
  return (
    <div className="production-settings-form">
      <SettingsField label="制作模式">
        <Select
          id="production-mode"
          label="制作模式"
          value={value.mode}
          onChange={(v) => patch({ mode: v as Settings["mode"] })}
          options={[
            { value: "smart", label: "智能模式 · 引导规划" },
            { value: "professional", label: "专业模式 · 逐镜编辑" },
          ]}
        />
      </SettingsField>
      <SettingsField label={`成片目标时长 ${value.target_duration} 秒`}>
        <div className="production-duration-presets">
          {[15, 30, 60, 90, 120, 180].map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={value.target_duration === n}
              onClick={() => patch({ target_duration: n })}
            >
              {n}s
            </button>
          ))}
        </div>
        <input
          aria-label="自定义目标时长"
          type="number"
          min={5}
          max={600}
          value={value.target_duration}
          onChange={(e) => patch({ target_duration: Number(e.target.value) })}
        />
      </SettingsField>
      <p className="production-settings-note">
        这是整部成片的目标，不是模型单次生成时长。实际片段需在模型能力内生成，并在剪辑中调整。
      </p>
      <SettingsField label="剧情保留策略">
        <Select
          id="retention"
          label="剧情保留策略"
          value={value.retention ?? "balanced"}
          onChange={(v) => patch({ retention: v as Settings["retention"] })}
          options={[
            { value: "strict", label: "严格保留 · 优先保留事件与对白" },
            { value: "balanced", label: "平衡改编 · 压缩次要情节" },
            { value: "concise", label: "精简提炼 · 聚焦关键冲突" },
          ]}
        />
      </SettingsField>
      <div className="production-settings-row">
        <SettingsField label="成片画幅">
          <Select
            id="aspect-ratio"
            label="成片画幅"
            value={value.aspect_ratio ?? "9:16"}
            onChange={(v) =>
              patch({ aspect_ratio: v as Settings["aspect_ratio"] })
            }
            options={["9:16", "16:9", "1:1"].map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </SettingsField>
        <SettingsField label="输出分辨率">
          <Select
            id="output-resolution"
            label="输出分辨率"
            value={value.resolution ?? "1080"}
            onChange={(v) => patch({ resolution: v as Settings["resolution"] })}
            options={[
              { value: "720", label: "720p" },
              { value: "1080", label: "1080p" },
            ]}
          />
        </SettingsField>
      </div>
      <SettingsField label="视觉风格">
        <textarea
          rows={2}
          maxLength={500}
          placeholder="例如：日系动画、克制的电影感"
          value={value.visual_style}
          onChange={(e) => patch({ visual_style: e.target.value })}
        />
      </SettingsField>
      <SettingsField label="叙事语言">
        <input
          value={value.language}
          maxLength={30}
          onChange={(e) => patch({ language: e.target.value })}
        />
      </SettingsField>
      <label className="production-check">
        <input
          type="checkbox"
          checked={value.prefer_character_images}
          onChange={(e) => patch({ prefer_character_images: e.target.checked })}
        />
        优先采用已有人物参考形象
      </label>
      <details className="production-settings-advanced">
        <summary>高级制作设置</summary>
        <SettingsField label="目标镜头数量（可留空）">
          <input
            type="number"
            min={1}
            max={100}
            value={value.target_shots ?? ""}
            onChange={(e) =>
              patch({
                target_shots: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </SettingsField>
        <SettingsField label="镜头节奏">
          <Select
            id="pacing"
            label="镜头节奏"
            value={value.pacing ?? "balanced"}
            onChange={(v) => patch({ pacing: v as Settings["pacing"] })}
            options={[
              { value: "slow", label: "舒缓" },
              { value: "balanced", label: "平衡" },
              { value: "fast", label: "紧凑" },
            ]}
          />
        </SettingsField>
        <SettingsField label="对白保留">
          <Select
            id="dialogue-retention"
            label="对白保留"
            value={value.dialogue_retention ?? "core"}
            onChange={(v) =>
              patch({
                dialogue_retention: v as Settings["dialogue_retention"],
              })
            }
            options={[
              { value: "full", label: "尽量完整" },
              { value: "core", label: "核心对白" },
              { value: "minimal", label: "尽量精简" },
            ]}
          />
        </SettingsField>
        <SettingsField label="摄影机运动风格">
          <input
            value={value.camera_style}
            maxLength={200}
            onChange={(e) => patch({ camera_style: e.target.value })}
          />
        </SettingsField>
        <SettingsField label="场景一致性">
          <Select
            id="scene-continuity"
            label="场景一致性"
            value={value.scene_consistency ?? "continuous"}
            onChange={(v) =>
              patch({
                scene_consistency: v as Settings["scene_consistency"],
              })
            }
            options={[
              { value: "continuous", label: "保持场景连续" },
              { value: "independent", label: "允许独立场景设计" },
            ]}
          />
        </SettingsField>
        <label className="production-check">
          <input
            type="checkbox"
            checked={value.allow_transitions}
            onChange={(e) => patch({ allow_transitions: e.target.checked })}
          />
          允许补充不改变关键剧情的过渡镜头
        </label>
        <p className="production-settings-note">
          当前导出为
          30fps。配音、背景音乐、音效与字幕制作尚未接入，不会因填写制作计划而自动生成。
        </p>
      </details>
      <p className="production-settings-note">
        费用暂无法预估：当前系统尚未配置有效价格与 Credits
        余额。不会显示虚构报价；本阶段每次媒体生成仍需手动提交。
      </p>
    </div>
  );
}
