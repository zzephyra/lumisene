import { afterEach, expect, it, vi } from "vitest";
import { renderMask } from "./utils/export-mask";
import { resizeSelection } from "./utils/selection";

afterEach(() => vi.restoreAllMocks());
it("erases to black, keeps opaque mask semantics, and paints single clicks", () => {
  const colors: string[] = [];
  const context = { fillStyle: "", strokeStyle: "", globalCompositeOperation: "", beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(), stroke: () => colors.push(context.strokeStyle) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  renderMask(200, 100, [
    { id: "a", mode: "add", width: 20, points: [50, 50] },
    { id: "b", mode: "remove", width: 10, points: [50, 50, 55, 50] },
  ]);
  expect(colors).toEqual(["#fff", "#000"]);
  expect(context.globalCompositeOperation).toBe("source-over");
  expect(context.arc).toHaveBeenCalledWith(50, 50, 10, 0, Math.PI * 2);
});
it("writes the resized rectangle into the submitted mask", () => {
  const rects: number[][] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalCompositeOperation: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn((x: number, y: number, width: number, height: number) => {
      rects.push([x, y, width, height]);
    }),
    save: vi.fn(),
    restore: vi.fn(),
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const selection = { x: 40, y: 30, width: 80, height: 50 };
  renderMask(400, 200, [], selection);
  const resized = resizeSelection(selection, "se", 12, -6, 400, 200);
  renderMask(400, 200, [], resized);
  expect(rects).toEqual([
    [0, 0, 400, 200],
    [40, 30, 80, 50],
    [0, 0, 400, 200],
    [resized?.x, resized?.y, resized?.width, resized?.height],
  ]);
});
