import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneDraft } from "./use-scene-draft";
import { write, type Scene } from "./api";
vi.mock("./api", () => ({ write: vi.fn(), message: (e: Error) => e.message }));
const scene: Scene = {
  id: "scene",
  chapter_id: "chapter",
  title: "First",
  summary: "",
  status: "draft",
  location: "",
  time_of_day: "",
  setting: "",
  character_ids: [],
  blocks: [],
  schema_version: 1,
  version: 1,
  order_index: 0,
  created_at: "",
  updated_at: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
describe("scene autosave", () => {
  it("serializes edits during a request using the acknowledged version", async () => {
    let finish!: (value: Scene) => void;
    vi.mocked(write)
      .mockImplementationOnce(
        () =>
          new Promise<Scene>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...scene, version: 3 });
    const { result } = renderHook(() => useSceneDraft("/plot", scene, vi.fn()));
    act(() => result.current.change({ ...scene, title: "Second" }));
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.flush();
    });
    act(() => result.current.change({ ...scene, title: "Third" }));
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ...scene, version: 2 });
      await saving;
    });
    expect(write).toHaveBeenNthCalledWith(
      2,
      "/plot/scenes/scene",
      "PATCH",
      expect.objectContaining({ title: "Third", expected_version: 2 }),
    );
    expect(result.current.state).toBe("saved");
  });
  it("keeps failed edits and retries without pretending they were saved", async () => {
    vi.mocked(write)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...scene, version: 2 });
    const { result } = renderHook(() => useSceneDraft("/plot", scene, vi.fn()));
    act(() => result.current.change({ ...scene, title: "Draft" }));
    await act(async () => {
      expect(await result.current.flush()).toBe(false);
    });
    expect(result.current.state).toBe("error");
    expect(result.current.draft.title).toBe("Draft");
    expect(sessionStorage.getItem("plot-draft:/plot:scene")).toContain("Draft");
    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });
    await waitFor(() => expect(result.current.state).toBe("saved"));
  });
});
