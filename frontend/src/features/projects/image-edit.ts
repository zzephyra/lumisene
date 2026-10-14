import type { outpaintMetadata } from "./workspace/image-editor/utils/outpaint";
import { apiRequest, ApiError } from "../../lib/api";

export type InpaintRequest = {
  image: Blob;
  mask: Blob;
  prompt: string;
};

export type EraseRequest = {
  image: Blob;
  mask: Blob;
};

function unavailable(message: string): Promise<never> {
  return Promise.reject(
    new ApiError({
      status: 501,
      code: "not_implemented",
      message,
      details: {},
      requestId: null,
    }),
  );
}

export function requestErase(_input: EraseRequest): Promise<never> {
  return unavailable("消除接口尚未接入");
}

import type { components } from "../../api/schema";
import { isRecord } from "../../lib/record";
import { parseTask } from "./image-generation";

type EditorOption = components["schemas"]["ImageEditorOption"];

export async function getEditorOptions(
  projectId: string,
  signal?: AbortSignal,
): Promise<EditorOption[]> {
  const body = await apiRequest({
    path: `/api/v1/projects/${projectId}/image-editor-options`,
    signal,
  });
  if (
    !Array.isArray(body) ||
    !body.every(
      (row): row is EditorOption =>
        isRecord(row) &&
        typeof row.capability === "string" &&
        typeof row.available === "boolean" &&
        (row.limits == null || (isRecord(row.limits) && [row.limits.max_width, row.limits.max_height, row.limits.max_pixels].every((value) => typeof value === "number" && Number.isInteger(value) && value > 0))) &&
        (row.model_name === null || typeof row.model_name === "string") &&
        (row.reason === null || typeof row.reason === "string") &&
        (row.duration === null || typeof row.duration === "number") &&
        Array.isArray(row.resolutions) &&
        row.resolutions.every((item) => typeof item === "string"),
    )
  ) {
    throw new Error("模型配置响应无效");
  }
  return body;
}

function encoded(blob: Blob): Promise<string> {
  if (blob.size > 80 * 1024 * 1024)
    return Promise.reject(new Error("图片不得超过 80 MB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result.split(",")[1] ?? "")
        : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function requestImageAction(
  projectId: string,
  input: {
    image: Blob;
    mask?: Blob;
    prompt: string;
    kind: "image" | "video";
    resolution: string;
    parameters?: Record<string, string | number>;
    outpaint?: ReturnType<typeof outpaintMetadata>;
  },
  attempt: { inputId: string; key: string },
  signal?: AbortSignal,
) {
  const upload: components["schemas"]["SaveGenerationInputRequest"] = {
    id: attempt.inputId,
    image_base64: await encoded(input.image),
    mask_base64: input.mask ? await encoded(input.mask) : null,
  };
  const saved = await apiRequest({
    path: `/api/v1/projects/${projectId}/generation-inputs`,
    method: "POST",
    csrf: true,
    body: upload,
    signal,
  });
  if (!isRecord(saved) || saved.id !== attempt.inputId)
    throw new Error("图片上传响应无效");
  const body: components["schemas"]["CreateGenerationRequest"] = {
    kind: input.kind,
    input_id: attempt.inputId,
    prompt: input.prompt,
    parameters:
      input.kind === "video"
        ? { duration: 5, resolution: input.resolution }
        : input.outpaint ? { outpaint: input.outpaint } : input.parameters ?? {},
  };
  const result = parseTask(
    await apiRequest({
      path: `/api/v1/projects/${projectId}/generation-tasks`,
      method: "POST",
      csrf: true,
      body,
      headers: { "Idempotency-Key": attempt.key },
      signal,
    }),
  );
  if (!result) throw new Error("任务响应无效");
  return result;
}
