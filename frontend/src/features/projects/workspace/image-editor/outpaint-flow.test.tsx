import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useOutpaint } from "./hooks/use-outpaint";
import { getEditorOptions, requestImageAction } from "../../image-edit";
import { getImageGeneration } from "../../image-generation";
import { exportOutpaint } from "./utils/export-outpaint";
vi.mock("../../image-edit", () => ({
  getEditorOptions: vi.fn(),
  requestImageAction: vi.fn(),
}));
vi.mock("../../image-generation", () => ({ getImageGeneration: vi.fn() }));
vi.mock("./utils/export-outpaint", () => ({ exportOutpaint: vi.fn() }));
const documentState = {
  source: document.createElement("canvas"),
  width: 1024,
  height: 1024,
  strokes: [],
};
const queued = {
  id: "task-1",
  kind: "image" as const,
  status: "queued",
  prompt: "森林",
  error: null,
  allowed_actions: [],
  output_asset_ids: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEditorOptions).mockResolvedValue([
    {
      capability: "image_outpaint",
      available: true,
      reason: null,
      model_name: "image-out-painting",
      resolutions: [],
      duration: null,
      limits: { max_width: 4096, max_height: 4096, max_pixels: 16_777_216 },
    },
  ]);
  vi.mocked(exportOutpaint).mockResolvedValue({
    image: new Blob(["image"]),
    width:1024,height:1024,extension:{left:205,right:205,top:205,bottom:205},
  });
  vi.mocked(requestImageAction).mockResolvedValue(queued);
});
it("keeps range on failure, locks concurrent submissions and retries with a fresh key", async () => {
  vi.mocked(getImageGeneration).mockResolvedValue({
    ...queued,
    status: "failed",
  });
  const done = vi.fn();
  const { result } = renderHook(() =>
    useOutpaint("p", "a.png", documentState, "森林", done),
  );
  await waitFor(() => expect(result.current.available).toBe(true));
  act(() => {
    result.current.reset();
    result.current.setPrompt("一位绿色仙子");
  });
  const range = result.current.extension;
  await act(async () => {
    await Promise.all([result.current.generate(), result.current.generate()]);
  });
  await waitFor(() => expect(result.current.error).toContain("扩图失败"));
  expect(requestImageAction).toHaveBeenCalledTimes(1);
  expect(result.current.extension).toEqual(range);
  const first = vi.mocked(requestImageAction).mock.calls[0]![2].key;
  vi.mocked(getImageGeneration).mockResolvedValue({
    ...queued,
    status: "succeeded",
    output_asset_ids: ["new-asset"],
  });
  await act(async () => result.current.generate());
  await waitFor(() =>
    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ output_asset_ids: ["new-asset"] }),
    ),
  );
  expect(vi.mocked(requestImageAction).mock.calls[1]![2].key).not.toBe(first);
  expect(result.current.extension).toEqual({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
  expect(vi.mocked(requestImageAction).mock.calls[0]![1]).toEqual(
    expect.objectContaining({
      outpaint: expect.objectContaining({
        left_offset: 205,
        right_offset: 205,
      }),
      prompt: "一位绿色仙子",
    }),
  );
});
it("clears the previous image range and ignores its late result after switching sources", async () => {
  let finish: ((value: typeof queued) => void) | undefined;
  vi.mocked(getImageGeneration).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const done = vi.fn();
  const { result, rerender } = renderHook(
    ({ src }) => useOutpaint("p", src, documentState, "森林", done),
    { initialProps: { src: "a.png" } },
  );
  await waitFor(() => expect(result.current.available).toBe(true));
  act(() => result.current.reset());
  await act(async () => result.current.generate());
  await act(async () => result.current.generate());
  await waitFor(() => expect(finish).toBeDefined());
  rerender({ src: "b.png" });
  await act(async () => finish?.({ ...queued, status: "succeeded" }));
  expect(done).not.toHaveBeenCalled();
  expect(result.current.extension).toEqual({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
  expect(result.current.pending).toBe(false);
});
