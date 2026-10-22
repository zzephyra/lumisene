import type { components } from "../../api/schema";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
export type Chapter = components["schemas"]["ChapterView"];
export type Scene = components["schemas"]["SceneView"];
export type Block = components["schemas"]["SceneBlock"];
export type SceneInput = components["schemas"]["SceneInput"];
export type Job = components["schemas"]["PlotJobView"];
export type Result = components["schemas"]["PlotResult"];
export type Generate = components["schemas"]["PlotGenerateInput"];
export type Chapters = components["schemas"]["ChapterList"];
export type Scenes = components["schemas"]["SceneList"];
export const plotRoot = (project: string, story: string) =>
  `/api/v1/projects/${project}/stories/${story}/plot`;
export async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const value = await apiRequest({ path, signal });
  if (!isRecord(value) && !Array.isArray(value))
    throw new Error("无效的剧情响应");
  if (
    isRecord(value) &&
    "items" in value &&
    (!Array.isArray(value.items) || typeof value.version !== "number")
  )
    throw new Error("无效的剧情列表");
  return value as T;
}
export async function write<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  key?: string,
): Promise<T> {
  const value = await apiRequest({
    path,
    method,
    body,
    csrf: true,
    ...(key ? { headers: { "Idempotency-Key": key } } : {}),
  });
  return value as T;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";
