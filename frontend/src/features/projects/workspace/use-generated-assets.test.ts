import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { listImageGenerations } from "../image-generation";
import { useGeneratedAssets } from "./use-generated-assets";
vi.mock("../image-generation", () => ({ listImageGenerations: vi.fn() }));
it("loads paginated image and video results and clears data when switching projects", async () => {
  vi.mocked(listImageGenerations).mockImplementation(async (project, _signal, kind, offset) => {
    if (project === "second") return [];
    if (kind === "video") return [{ id: "video", status: "succeeded", prompt: "视频", output_asset_ids: ["v1"] }] as never;
    if (!offset) return Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, status: "succeeded", prompt: "图片", output_asset_ids: [`i${i}`] })) as never;
    return [{ id: "old", status: "succeeded", prompt: "旧图", output_asset_ids: ["old-image"] }] as never;
  });
  const hook = renderHook(({ project }) => useGeneratedAssets(project), { initialProps: { project: "first" } });
  await waitFor(() => expect(hook.result.current.items).toHaveLength(22));
  expect(hook.result.current.items.map(item => item.id)).toContain("v1");
  expect(hook.result.current.items.map(item => item.id)).toContain("old-image");
  hook.rerender({ project: "second" });
  expect(hook.result.current.items).toHaveLength(0);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  hook.unmount();
});
