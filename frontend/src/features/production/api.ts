import type { components } from "../../api/schema";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
export type Production = components["schemas"]["ProductionView"];
export type Summary = components["schemas"]["ProductionSummary"];
export type Board = components["schemas"]["Board"];
export type Shot = components["schemas"]["Shot"];
export type Scene = components["schemas"]["ProductionScene"];
export type Run = components["schemas"]["RunView"];
export type Capability = components["schemas"]["CapabilityView"];
export type ImageChoice = components["schemas"]["ImageChoice"];
export type CharacterImages = components["schemas"]["CharacterImagesView"];
export type Prompt = components["schemas"]["PromptView"];
export const root = (project: string, story?: string) =>
  story
    ? `/api/v1/projects/${project}/stories/${story}/productions`
    : `/api/v1/projects/${project}/productions`;
export const mediaUrl = (project: string, asset: string) =>
  `/api/v1/projects/${project}/assets/${asset}/content`;
export const message = (error: unknown) => {
  const text = error instanceof Error ? error.message : "操作失败，请重试";
  if (/traceback|stack trace|The model provider|HTTP 5\d\d/i.test(text))
    return "生成服务暂时不可用，请稍后重试";
  return text
    .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "相关镜头")
    .slice(0, 180);
};
export async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const result = await apiRequest({ path, signal });
  if (!isRecord(result) && !Array.isArray(result))
    throw new Error("无效的工作台响应");
  return result as T;
}
export async function change(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
  key?: string,
): Promise<Production> {
  const result = await apiRequest({
    path,
    method,
    body,
    csrf: true,
    ...(key ? { headers: { "Idempotency-Key": key } } : {}),
  });
  if (
    !isRecord(result) ||
    typeof result.version !== "number" ||
    !isRecord(result.board) ||
    !Array.isArray(result.board.scenes) ||
    !Array.isArray(result.runs)
  )
    throw new Error("制作响应无效");
  return result as Production;
}
export const active = (status: string) =>
  ["queued", "running", "submitting", "cancel_requested"].includes(status);
export const statusName = (status: string) =>
  ({
    queued: "排队中",
    running: "生成中",
    submitting: "正在提交",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
    cancel_requested: "取消中",
  })[status] ?? status;
export function newShot(): Shot {
  return {
    id: crypto.randomUUID(),
    description: "新镜头",
    narrative_role: "action",
    dialogue: "",
    script_excerpt: "",
    character_ids: [],
    framing: "中景",
    angle: "平视",
    movement: "固定",
    action: "",
    emotion: "",
    environment: "",
    duration: 5,
    prompt: "",
    confirmed: false,
    reference_asset_id: null,
    character_image_id: null,
    reference_character_id: null,
    selected_image_id: null,
    selected_video_id: null,
  };
}
export function newScene(): Scene {
  return {
    id: crypto.randomUUID(),
    title: "新场景",
    description: "",
    setting: "",
    time_of_day: "",
    character_ids: [],
    shots: [newShot()],
  };
}
export function updateShot(
  board: Board,
  id: string,
  patch: Partial<Shot>,
): Board {
  return {
    ...board,
    scenes: (board.scenes ?? []).map((scene) => ({
      ...scene,
      shots: (scene.shots ?? []).map((shot) =>
        shot.id === id ? { ...shot, ...patch } : shot,
      ),
    })),
  };
}
export function moveShot(board: Board, from: string, to: string): Board {
  const copy = structuredClone(board);
  const origin = (copy.scenes ?? []).find((s) =>
    s.shots?.some((x) => x.id === from),
  );
  const target = (copy.scenes ?? []).find((s) =>
    s.shots?.some((x) => x.id === to),
  );
  if (!origin || !target || from === to) return board;
  const index = origin.shots!.findIndex((x) => x.id === from);
  const [shot] = origin.shots!.splice(index, 1);
  target.shots!.splice(
    target.shots!.findIndex((x) => x.id === to),
    0,
    shot,
  );
  return copy;
}
export type Settings = components["schemas"]["ProductionSettings"];
export type Source = components["schemas"]["ProductionSource"];
export type Selection = components["schemas"]["ChapterSelection"];
export type Impact = components["schemas"]["SourceImpact"];
export const defaultSettings: Settings = {
  wizard_step: 0,
  audio_mode: "source",
  mode: "smart",
  target_duration: 90,
  retention: "balanced",
  aspect_ratio: "9:16",
  resolution: "1080",
  fps: 30,
  visual_style: "",
  language: "中文",
  prefer_character_images: true,
  character_consistency: "reference",
  scene_consistency: "continuous",
  target_shots: null,
  pacing: "balanced",
  camera_style: "克制、服务叙事",
  dialogue_retention: "core",
  allow_transitions: false,
};
export function resolveSettings(
  value: Partial<Settings> | null | undefined,
): Settings {
  return { ...defaultSettings, ...(value ?? {}) };
}
