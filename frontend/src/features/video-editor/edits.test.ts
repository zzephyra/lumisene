import { describe, expect, it } from "vitest";
import type { Composition, EditorDocument } from "./api";
import { editClip, removeClip, splitClip } from "./edits";
import { createEditorStore } from "./store";
import { frameToPixel, pixelToFrame, snap, timecode } from "./time";
import { isTextInput } from "./shortcuts";
const composition: Composition = {
  schema_version: 1,
  fps: 30,
  frame: "fit",
  width: 1920,
  height: 1080,
  duration_in_frames: 300,
  tracks: [
    {
      id: "video",
      type: "video",
      clips: [
        {
          id: "a",
          asset_id: "asset",
          timeline_start_frame: 30,
          source_start_frame: 30,
          source_end_frame: 120,
          original_duration: 150,
          duration: 90,
          volume: 1,
          speed: 1,
          muted: false,
        },
        {
          id: "b",
          asset_id: "asset",
          timeline_start_frame: 150,
          source_start_frame: 0,
          source_end_frame: 90,
          original_duration: 150,
          duration: 90,
          volume: 1,
          speed: 1,
          muted: false,
        },
      ],
    },
  ],
};
describe("frame editing", () => {
  it("uses reversible frame conversion and pixel-based snapping", () => {
    expect(pixelToFrame(frameToPixel(127, 2.5), 2.5)).toBe(127);
    expect(timecode(1832)).toBe("01:01:02");
    expect(snap(98, [0, 100], 3)).toBe(100);
    expect(snap(98, [0, 100], 5)).toBe(98);
  });
  it("splits source and timeline continuously without changing total duration", () => {
    const result = splitClip(composition, "a", 75, "c");
    expect(result.tracks[0].clips[0]).toMatchObject({
      source_start_frame: 30,
      source_end_frame: 75,
      duration: 45,
    });
    expect(result.tracks[0].clips[1]).toMatchObject({
      source_start_frame: 75,
      source_end_frame: 120,
      timeline_start_frame: 75,
      duration: 45,
    });
    expect(splitClip(composition, "a", 30, "c")).toBe(composition);
  });
  it("keeps source bounds and prevents overlap on trim and movement", () => {
    expect(
      editClip(composition, "a", -999, "left", 0, 3, false).tracks[0].clips[0],
    ).toMatchObject({
      source_start_frame: 0,
      timeline_start_frame: 0,
      duration: 120,
    });
    expect(
      editClip(composition, "a", 999, "right", 0, 3, false).tracks[0].clips[0],
    ).toMatchObject({ source_end_frame: 150, duration: 120 });
    expect(
      editClip(composition, "a", 999, "move", 0, 3, false).tracks[0].clips[0]
        .timeline_start_frame,
    ).toBe(60);
  });
  it("deletes without closing gaps", () => {
    const result = removeClip(composition, "a");
    expect(result.tracks[0].clips[0].timeline_start_frame).toBe(150);
    expect(result.duration_in_frames).toBe(300);
  });
  it("commits many gesture updates as one history entry; playhead is not history", () => {
    const document: EditorDocument = {
      id: "doc",
      project_id: "p",
      title: "Edit",
      composition,
      version: 1,
      updated_at: "now",
    };
    const store = createEditorStore(document);
    const before = store.getState().draft;
    for (let i = 1; i <= 10; i++)
      store.getState().preview({
        ...before,
        composition: editClip(composition, "a", i, "left", 0, 3, false),
      });
    store.getState().commitGesture(before);
    store.getState().seek(20);
    store.getState().setPlaying(true);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().draft).toEqual(before);
    expect(store.getState().frame).toBe(20);
    store.getState().redo();
    expect(
      store.getState().draft.composition.tracks[0].clips[0].source_start_frame,
    ).toBe(40);
  });
  it("keeps a gesture that returns to its origin clean", () => {
    const store = createEditorStore({
      id: "doc",
      project_id: "p",
      title: "Edit",
      composition,
      version: 1,
      updated_at: "now",
    });
    const before = store.getState().draft;
    store
      .getState()
      .preview({ ...before, composition: structuredClone(composition) });
    store.getState().commitGesture(before);
    expect(store.getState().draft).toBe(store.getState().saved);
    expect(store.getState().past).toHaveLength(0);
  });
  it("does not capture typing shortcuts", () => {
    expect(isTextInput(document.createElement("input"))).toBe(true);
    expect(isTextInput(document.createElement("textarea"))).toBe(true);
    expect(isTextInput(document.createElement("div"))).toBe(false);
  });
});
