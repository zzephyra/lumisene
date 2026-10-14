import type { components } from "../../api/schema";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
export type PublicWork = components["schemas"]["PublicWork"];
export type WorkPublication = components["schemas"]["WorkPublication"];

function publication(value: unknown): WorkPublication {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.public !== "boolean" || typeof value.can_publish !== "boolean") throw new Error("无法读取公开状态");
  return { id: value.id, public: value.public, can_publish: value.can_publish };
}
export async function getPublications(projectId: string, signal?: AbortSignal): Promise<WorkPublication[]> {
  const result: WorkPublication[] = [];
  for (let offset = 0; ; offset += 100) {
    const data = await apiRequest({ path: `/api/v1/projects/${projectId}/assets/publication?offset=${offset}`, signal });
    if (!Array.isArray(data)) throw new Error("无法读取公开状态");
    result.push(...data.map(publication));
    if (data.length < 100) return result;
  }
}
export async function setPublication(projectId: string, id: string, isPublic: boolean): Promise<WorkPublication> {
  return publication(await apiRequest({ path: `/api/v1/projects/${projectId}/assets/${id}/publication`, method: "PATCH", csrf: true, body: { public: isPublic } }));
}
export async function getPublicWorks(userId: string, kind: string, offset: number, signal?: AbortSignal): Promise<PublicWork[]> {
  const data = await apiRequest({ path: `/api/v1/public/users/${userId}/works?kind=${kind}&offset=${offset}`, signal, unauthorized: "throw" });
  if (!Array.isArray(data)) throw new Error("无法读取作品");
  return data.map(value => {
    if (!isRecord(value) || typeof value.id !== "string" || !["image", "video"].includes(String(value.kind)) || typeof value.published_at !== "string" || !(value.width === null || typeof value.width === "number") || !(value.height === null || typeof value.height === "number")) throw new Error("无法读取作品");
    return { id: value.id, kind: value.kind as PublicWork["kind"], width: value.width, height: value.height, published_at: value.published_at };
  });
}
export const publicContentPath = (userId: string, id: string) => `/api/v1/public/users/${userId}/works/${id}/content`;
