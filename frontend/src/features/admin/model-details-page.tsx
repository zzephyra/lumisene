import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Film, Power, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { userFacingMessage } from "../../lib/api";
import {
  createModelConfig,
  disableModelConfig,
  enableModelConfig,
  listModelCatalog,
  modelAdminQueryKey,
  modelAssignmentQueryKey,
} from "./api";
import { useAdminItems } from "./model-admin-page";

import { ModelOperationTags, operationLabels } from "./model-presentation";

const labels: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  resolutions: "清晰度",
  sizes: "尺寸",
  ratios: "画幅比例",
  duration: "时长",
  durations: "时长",
  text_to_video: "视频",
  text_to_image: "图片",
  image_inpaint: "图像编辑",
  text_generation: "文本",
  embedding: "向量",
  speech_synthesis: "语音合成",
  speech_recognition: "语音识别",
};

const descriptions: Record<string, string> = {
  扩图: "expand：四边比例 1–2，向外自然延展。已接入编辑器。",
  局部重绘: "description_edit_with_mask：白色蒙版为编辑区，黑色为保留区。已接入编辑器。",
  指令编辑: "description_edit：参考图片结合文字指令编辑，描述最长 800 字符。已接入参考图生成。",
  风格迁移: "stylization_all / stylization_local：支持整图或蒙版区域风格化，产品入口待接入。",
  图像超分: "super_resolution：放大倍数 1–4，产品入口待接入。",
  图像上色: "colorization：黑白图像上色，产品入口待接入。",
  去文字水印: "remove_watermark：移除图像文字水印，产品入口待接入。",
  涂鸦成图: "doodle：线稿或涂鸦生成，产品入口待接入。",
  卡通特征保持: "control_cartoon_feature：保持参考卡通特征生成新场景，产品入口待接入。",
  专用扩图: "以原图和上下左右扩展像素调用 image-out-painting，支持最佳质量。异步生成完整扩图，无需蒙版，不支持文字提示词指定新增主体。",
  文生视频: "通过文字描述主体动作、场景与镜头运动，生成视频片段。",
  图生视频: "以图片作为视觉输入，结合文字描述生成动态画面。",
  视频参考: "接受视频作为参考输入，具体参考方式以供应商接口为准。",
  音频输入: "接受音频作为输入素材，具体配合方式以供应商接口为准。",
  文生图: "根据文字描述生成图片，可用尺寸见下方参数范围。",
};

function ConfigValues({ values }: { values: Record<string, unknown> }) {
  return Object.keys(values).length ? (
    <dl className="admin-config-values">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{labels[key] ?? key}</dt>
          <dd>
            {Array.isArray(value)
              ? value.join("、")
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="admin-helper">未设置额外配置</p>
  );
}

export function ModelDetailsScreen() {
  const items = useAdminItems();
  const [search] = useSearchParams();
  const providerId = search.get("provider") ?? "";
  const name = search.get("model") ?? "";
  const catalog = useQuery({
    queryKey: ["admin", "model-catalog"],
    queryFn: ({ signal }) => listModelCatalog(signal),
  });
  const provider = catalog.data?.find((entry) => entry.id === providerId);
  const model = provider?.models.find((entry) => entry.name === name);
  const configs = items
    .filter(
      (item) =>
        item.model_name === name &&
        (item.provider === providerId || item.secret_ref === providerId),
    )
    .sort((a, b) => b.config_version - a.config_version);
  const selected =
    configs.find((item) => item.id === search.get("config")) ?? configs[0];
  const missing =
    model?.capabilities.filter(
      (capability) => !configs.some((item) => item.capability === capability),
    ) ?? [];
  const client = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: async (input: {
      kind: "register" | "enable" | "disable";
      id?: string;
    }) => {
      if (input.kind === "register" && model && provider) {
        // Refresh after every successful capability so a partial failure is safely retryable.
        for (const capability of missing) {
          await createModelConfig({
            provider: provider.id,
            secret_ref: provider.id,
            model_name: model.name,
            capability,
            parameters_schema: model.parameters,
            limits: {},
          });
          await client.invalidateQueries({ queryKey: modelAdminQueryKey });
        }
      } else if (input.id)
        await (input.kind === "enable"
          ? enableModelConfig(input.id)
          : disableModelConfig(input.id));
    },
    onSettled: async () => {
      setConfirmId(null);
      await client.invalidateQueries({ queryKey: modelAdminQueryKey });
      await client.invalidateQueries({ queryKey: modelAssignmentQueryKey });
    },
  });
  if (catalog.isPending) return <p role="status">正在读取模型详情…</p>;
  if (!model && !selected)
    return (
      <div>
        <Link to="/admin/models">返回模型目录</Link>
        <p role="alert">
          {catalog.isError ? "模型目录加载失败，请重试。" : "未找到这个模型。"}
        </p>
        <Button onClick={() => void catalog.refetch()}>重新加载</Button>
      </div>
    );
  return (
    <section className="admin-model-detail">
      <Link className="admin-detail-back" to="/admin/models">
        <ArrowLeft size={16} />
        模型目录
      </Link>
      <header className="admin-detail-hero">
        <div className="admin-detail-symbol">
          <Film size={28} />
        </div>
        <div>
          <p className="admin-helper">
            {provider?.alias_zh || provider?.alias_en || providerId}
          </p>
          <h1>{model?.alias_zh || model?.alias_en || name}</h1>
          <p className="admin-helper">{name}</p>
          <div className="admin-detail-tags">
            {(model?.capabilities ?? [selected!.capability]).map((value) => (
              <span className="admin-operation-tag" key={value}>
                {labels[value] ?? value}
              </span>
            ))}
            {model && <ModelOperationTags model={model} />}
          </div>
        </div>
      </header>
      <div className="admin-detail-grid">
        <div className="admin-detail-main">
          <article className="admin-detail-card">
            <h2>模型能力</h2>
            <p className="admin-helper">
              支持范围来自供应商目录配置。实际可用能力取决于接口适配与已登记版本。
            </p>
            {model && (
              <div className="admin-capability-descriptions">
                {operationLabels(model).map((label) => (
                  <div key={label}>
                    <h3>{label}</h3>
                    <p className="admin-helper">{descriptions[label]}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="admin-modality-grid">
              {(model?.inputs ?? []).map((input) => (
                <div key={input}>
                  <span>{labels[input] ?? input}</span>
                  <small>支持输入</small>
                </div>
              ))}
            </div>
            {!model?.inputs.length && (
              <p className="admin-helper">
                供应商未声明输入类型，请核对接口配置。
              </p>
            )}
          </article>
          <article className="admin-detail-card">
            <h2>支持参数</h2>
            <p className="admin-helper">供应商目录可选范围</p>
            {Object.entries(model?.parameters ?? {}).map(([key, values]) => (
              <div className="admin-detail-parameter" key={key}>
                <h3>{labels[key] ?? key}</h3>
                <div className="admin-detail-tags">
                  {values.map((value) => (
                    <span className="admin-operation-tag" key={value}>
                      {value === -1
                        ? "智能时长"
                        : value === "adaptive"
                          ? "自适应"
                          : `${value}${key.startsWith("duration") ? " 秒" : ""}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {!Object.keys(model?.parameters ?? {}).length && (
              <p className="admin-helper">未声明可选参数。</p>
            )}
          </article>
          {selected && (
            <article className="admin-detail-card">
              <h2>已登记版本参数 · v{selected.config_version}</h2>
              <p className="admin-helper">
                已发布的配置不可编辑，可能与最新供应商目录不同。
              </p>
              <h3 className="mt-4 text-sm">参数</h3>
              <ConfigValues values={selected.parameters_schema} />
              <h3 className="mt-4 text-sm">使用限制</h3>
              <ConfigValues values={selected.limits} />
            </article>
          )}
        </div>
        <aside className="admin-detail-card admin-detail-actions">
          <h2>模型管理</h2>
          <p className="admin-helper">
            启用后可前往业务指定，将模型用于生成流程。
          </p>
          {configs.map((config) => (
            <div className="admin-detail-config" key={config.id}>
              <div className="flex items-center justify-between gap-2">
                <strong>
                  {labels[config.capability] ?? config.capability} · v
                  {config.config_version}
                </strong>
                <span
                  className={`admin-status ${config.enabled ? "is-active" : "is-inactive"}`}
                >
                  {config.enabled ? "已启用" : "已停用"}
                </span>
              </div>
              <p className="admin-helper">密钥名称：{config.secret_ref}</p>
              {confirmId === config.id ? (
                <div role="alert">
                  <p className="admin-helper">
                    停用会同时取消此版本的业务指定。确定继续？
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({ kind: "disable", id: config.id })
                      }
                    >
                      确认停用
                    </Button>
                    <Button
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => setConfirmId(null)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    config.enabled
                      ? setConfirmId(config.id)
                      : action.mutate({ kind: "enable", id: config.id })
                  }
                >
                  <Power size={14} />
                  {config.enabled ? "停用" : "启用"}
                </Button>
              )}
            </div>
          ))}
          {!configs.length && (
            <p className="admin-helper">尚未登记。登记后才能指定给业务使用。</p>
          )}
          {missing.length > 0 && (
            <Button
              disabled={action.isPending}
              onClick={() => action.mutate({ kind: "register" })}
            >
              <Plus size={15} />
              {action.isPending
                ? "正在处理…"
                : configs.length
                  ? "登记其余能力"
                  : "登记模型"}
            </Button>
          )}
          {action.isError && (
            <p className="text-danger text-sm" role="alert">
              {userFacingMessage(action.error)}
            </p>
          )}
          {action.isSuccess && (
            <p role="status" className="admin-helper">
              操作已完成。
            </p>
          )}
          <Link className="admin-detail-back" to="/admin/assignments">
            前往业务指定
            <ArrowUpRight size={14} />
          </Link>
        </aside>
      </div>
    </section>
  );
}
