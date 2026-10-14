import type { components } from "../../api/schema";
import { apiRequest, ApiError } from "../../lib/api";
import { isRecord } from "../../lib/record";
export type Skill = components["schemas"]["SkillItem"];
export type SkillDraft = components["schemas"]["SkillCreate"];
function parse(v: unknown): Skill {
  if (
    !isRecord(v) ||
    ![
      v.id,
      v.slug,
      v.name,
      v.description,
      v.content,
      v.created_at,
      v.updated_at,
    ].every((x) => typeof x === "string") ||
    (v.runtime_key !== undefined &&
      v.runtime_key !== null &&
      v.runtime_key !== "image.outpainting") ||
    typeof v.enabled !== "boolean" ||
    typeof v.version !== "number" ||
    !Number.isInteger(v.version)
  ) {
    throw new ApiError({
      status: 502,
      code: "invalid_response",
      message: "技能数据响应无效",
      details: {},
      requestId: null,
    });
  }
  return v as Skill;
}
export async function listSkills(
  q: string,
  status: string,
  page: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    q,
    offset: String(page * 20),
    limit: "20",
  });
  if (status) params.set("enabled", status);
  const v = await apiRequest({
    path: `/api/v1/admin/skills?${params}`,
    signal,
  });
  if (!isRecord(v) || !Array.isArray(v.items) || typeof v.total !== "number")
    throw new Error("技能列表响应无效");
  return { items: v.items.map(parse), total: v.total };
}
export async function saveSkill(draft: SkillDraft, row?: Skill) {
  return parse(
    await apiRequest({
      path: `/api/v1/admin/skills${row ? `/${row.id}` : ""}`,
      method: row ? "PATCH" : "POST",
      body: row
        ? {
            runtime_key: draft.runtime_key ?? null,
            name: draft.name,
            description: draft.description ?? "",
            content: draft.content,
            enabled: row.enabled,
            expected_version: row.version,
          }
        : draft,
    }),
  );
}
export async function operateSkill(row: Skill, action: "toggle" | "delete") {
  return apiRequest(
    action === "delete"
      ? {
          path: `/api/v1/admin/skills/${row.id}?expected_version=${row.version}`,
          method: "DELETE",
        }
      : {
          path: `/api/v1/admin/skills/${row.id}`,
          method: "PATCH",
          body: {
            runtime_key: row.runtime_key ?? null,
            name: row.name,
            description: row.description,
            content: row.content,
            enabled: !row.enabled,
            expected_version: row.version,
          },
        },
  );
}
