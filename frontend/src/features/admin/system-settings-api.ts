import { ApiError, apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";

export type DeletionPolicy = "retain_cloud_file" | "delete_cloud_file";
export type SystemSettings = {
  schema_version: number;
  revision: number;
  assets: { deletion_policy: DeletionPolicy };
};

function parse(value: unknown): SystemSettings {
  if (
    !isRecord(value) ||
    typeof value.schema_version !== "number" ||
    typeof value.revision !== "number" ||
    !isRecord(value.assets) ||
    (value.assets.deletion_policy !== "retain_cloud_file" &&
      value.assets.deletion_policy !== "delete_cloud_file")
  ) {
    throw new ApiError({
      status: 502,
      code: "invalid_response",
      message: "系统设置响应无效",
      details: {},
      requestId: null,
    });
  }
  return value as SystemSettings;
}

export function readSystemSettings(signal?: AbortSignal) {
  return apiRequest({ path: "/api/v1/admin/system-settings", signal }).then(parse);
}

export function saveSystemSettings(revision: number, policy: DeletionPolicy) {
  return apiRequest({
    method: "PATCH",
    path: "/api/v1/admin/system-settings",
    body: { revision, assets: { deletion_policy: policy } },
  }).then(parse);
}
