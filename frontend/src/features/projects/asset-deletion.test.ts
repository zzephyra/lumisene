import { describe, expect, it } from "vitest";
import { deletionMessage, type AssetDeletion } from "./asset-deletion";

const base: AssetDeletion = {
  asset_id: "a",
  policy: "delete_cloud_file",
  purge_status: null,
};

describe("deletion messages", () => {
  it("does not describe a failed cleanup as permanent removal", () => {
    expect(deletionMessage({ ...base, purge_status: "failed" })).toContain("不表示文件已经永久删除");
    expect(deletionMessage({ ...base, purge_status: "failed" })).toContain("清理失败");
  });

  it("explains a retained cloud file separately from hiding the work", () => {
    expect(deletionMessage({ ...base, policy: "retain_cloud_file" })).toContain("保留");
  });
});
