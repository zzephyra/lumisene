import type { ProviderModelOption } from "./api";

export function modelDetailsUrl(
  provider: string,
  model: string,
  config?: string,
) {
  return `/admin/models/details?${new URLSearchParams({ provider, model, ...(config ? { config } : {}) })}`;
}

export function operationLabels(model: ProviderModelOption): string[] {
  const tags: string[] = [];
  if (model.name === "wanx2.1-imageedit") return ["扩图", "局部重绘", "指令编辑", "风格迁移", "图像超分", "图像上色", "去文字水印", "涂鸦成图", "卡通特征保持"];
  if (model.name === "image-out-painting") return ["专用扩图"];
  if (model.capabilities.includes("text_to_video")) {
    // Legacy catalog entries do not declare modalities. Only explicit model identifiers
    // distinguish their text/image variants; do not infer support from the family name.
    if (model.name.includes("-i2v")) tags.push("图生视频");
    else if (model.name.includes("-t2v")) tags.push("文生视频");
    else {
      if (model.inputs.includes("text")) tags.push("文生视频");
      if (model.inputs.includes("image")) tags.push("图生视频");
    }
    if (model.inputs.includes("video")) tags.push("视频参考");
    if (model.inputs.includes("audio")) tags.push("音频输入");
  }
  if (model.capabilities.includes("text_to_image")) tags.push("文生图");
  return tags;
}

export function ModelOperationTags({ model }: { model: ProviderModelOption }) {
  return (
    <>
      {operationLabels(model).map((tag) => (
        <span className="admin-operation-tag" key={tag}>
          {tag}
        </span>
      ))}
    </>
  );
}
