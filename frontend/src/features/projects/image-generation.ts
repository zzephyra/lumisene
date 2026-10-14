import { apiRequest, ApiError, isApiError } from "../../lib/api";
import { isRecord } from "../../lib/record";

export type ImageModel = {
  id: string;
  provider: string;
  model_name: string;
};

export type GenerationTask = {
  id: string;
  status: string;
  prompt: string;
  output_asset_ids: string[];
  error: { code: string; message: string } | null;
  allowed_actions: string[];
  kind: "image" | "video";
};

function invalidResponse(): ApiError {
  return new ApiError({
    status: 500,
    code: "invalid_response",
    message: "响应无法识别",
    details: {},
    requestId: null,
  });
}

function parseModel(value: unknown, capability: string): ImageModel | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.model_name !== "string" ||
    value.capability !== capability
  ) {
    return null;
  }
  return { id: value.id, provider: value.provider, model_name: value.model_name };
}

export function parseTask(value: unknown): GenerationTask | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") {
    return null;
  }
  const prompt = typeof value.prompt === "string" ? value.prompt : "";
  const output_asset_ids = Array.isArray(value.output_asset_ids)
    ? value.output_asset_ids.filter((item): item is string => typeof item === "string")
    : [];
  const allowed_actions = Array.isArray(value.allowed_actions)
    ? value.allowed_actions.filter((item): item is string => typeof item === "string")
    : [];
  let error: GenerationTask["error"] = null;
  if (
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  ) {
    error = { code: value.error.code, message: value.error.message };
  }
  return {
    id: value.id,
    status: value.status,
    prompt,
    output_asset_ids,
    error,
    allowed_actions,
    kind: value.kind === "video" ? "video" : "image",
  };
}

export async function getActiveImageModel(
  projectId: string,
  signal?: AbortSignal,
  capability = "text_to_image",
): Promise<ImageModel | null> {
  try {
    const body = await apiRequest({
      path: `/api/v1/projects/${projectId}/active-model?capability=${capability}`,
      signal,
    });
    return parseModel(body, capability);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function createImageGeneration(
  projectId: string,
  prompt: string,
  idempotencyKey: string,
  parameters: { n?: number; size?: string; duration?: number },
  kind: "image" | "video" = "image",
): Promise<GenerationTask> {
  const body = await apiRequest({
    path: `/api/v1/projects/${projectId}/generation-tasks`,
    method: "POST",
    body: { prompt, parameters, reference_asset_ids: [], kind },
    csrf: true,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  const task = parseTask(body);
  if (!task) {
    throw invalidResponse();
  }
  return task;
}

export async function listImageGenerations(
  projectId: string,
  signal?: AbortSignal,
  kind: "image" | "video" = "image",
 offset = 0
): Promise<GenerationTask[]> {
  const body = await apiRequest({
    path: `/api/v1/projects/${projectId}/generation-tasks?kind=${kind}&offset=${offset}`,
    signal,
  });
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw invalidResponse();
  }
  return body.items.flatMap((item) => {
    const task = parseTask(item);
    return task ? [task] : [];
  });
}

export async function getImageGeneration(
  projectId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<GenerationTask> {
  const body = await apiRequest({
    path: `/api/v1/projects/${projectId}/generation-tasks/${taskId}`,
    signal,
  });
  const task = parseTask(body);
  if (!task) {
    throw invalidResponse();
  }
  return task;
}

export function assetContentPath(projectId: string, assetId: string): string {
  return `/api/v1/projects/${projectId}/assets/${assetId}/content`;
}
