import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";

export type AssetDeletion = {
  asset_id: string;
  policy: "retain_cloud_file" | "delete_cloud_file";
  purge_status: "pending" | "failed" | "purged" | null;
};

export function deletionMessage(result: AssetDeletion): string {
  if (result.purge_status === "failed") {
    return "作品已从列表隐藏，但云端文件清理失败。这不表示文件已经永久删除。";
  }
  if (result.purge_status === "purged") {
    return "作品已隐藏，对应的云端文件已清理。";
  }
  if (result.purge_status === "pending") {
    return "作品已隐藏，云端文件正在清理。清理完成前不会显示为已永久删除。";
  }
  return "作品已从列表隐藏，云端文件按策略保留。已签发的临时链接在过期前仍可能打开。";
}

export async function deleteWork(projectId: string, assetId: string): Promise<AssetDeletion> {
  const payload = await apiRequest({
    method: "POST",
    path: `/api/v1/projects/${projectId}/assets/${assetId}/deletion`,
  });
  if (
    !isRecord(payload) ||
    typeof payload.asset_id !== "string" ||
    (payload.policy !== "retain_cloud_file" && payload.policy !== "delete_cloud_file")
  ) {
    throw new Error("删除结果无法读取");
  }
  const status = payload.purge_status;
  return {
    asset_id: payload.asset_id,
    policy: payload.policy,
    purge_status: status === "pending" || status === "failed" || status === "purged" ? status : null,
  };
}
