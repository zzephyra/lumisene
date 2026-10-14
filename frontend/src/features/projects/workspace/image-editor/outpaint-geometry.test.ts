import { describe, expect, it } from "vitest";
import {
  calculateAspectRatioExtension,
  calculateTargetSize,
  calculateOriginalOffset,
  clampExtension,
  emptyExtension,
  outpaintMetadata,
  resizeOutpaint,
  screenDeltaToImageDelta,
  toFrame,
} from "./utils/outpaint";
import {
  imageToScreen,
  screenToImage,
  displayScale,
} from "./utils/coordinates";
import { outpaintGesture } from "./utils/hits";

const limits = { max_width: 4096, max_height: 4096, max_pixels: 16_777_216 };
describe("outpaint geometry", () => {
  it.each(["left", "right", "top", "bottom"] as const)(
    "extends only %s without resizing original",
    (edge) => {
      const e = { ...emptyExtension(), [edge]: 512 };
      expect(calculateTargetSize(1024, 1024, e)).toEqual({
        width: edge === "left" || edge === "right" ? 1536 : 1024,
        height: edge === "top" || edge === "bottom" ? 1536 : 1024,
      });
      expect(calculateOriginalOffset(e)).toEqual({
        x: edge === "left" ? 512 : 0,
        y: edge === "top" ? 512 : 0,
      });
    },
  );
  it("keeps asymmetric offsets and all four margins", () => {
    const e = { left: 200, right: 400, top: 100, bottom: 300 };
    expect(toFrame(1024, 1024, e)).toEqual({
      width: 1624,
      height: 1424,
      imageX: 200,
      imageY: 100,
    });
    expect(outpaintMetadata(1024, 1024, e)).toEqual({left_offset:200,right_offset:400,top_offset:100,bottom_offset:300,best_quality:false});
  });
  it.each([
    [1024, 1536, 16 / 9],
    [1536, 1024, 9 / 16],
    [1024, 1536, 4 / 3],
  ])("fits %s×%s into %s without clipping", (w, h, r) => {
    const result = calculateTargetSize(
      w,
      h,
      calculateAspectRatioExtension(w, h, r),
    );
    expect(result.width).toBeGreaterThanOrEqual(w);
    expect(result.height).toBeGreaterThanOrEqual(h);
    expect(Math.abs(result.width / result.height - r)).toBeLessThan(0.002);
  });
  it("clamps dimensions and total pixels", () => {
    const e = clampExtension(
      1024,
      1024,
      { left: 9000, right: 8000, top: 7000, bottom: 6000 },
      { ...limits, max_pixels: 4_000_000 },
    );
    const target = calculateTargetSize(1024, 1024, e);
    expect(target.width).toBeLessThanOrEqual(4096);
    expect(target.height).toBeLessThanOrEqual(4096);
    expect(target.width * target.height).toBeLessThanOrEqual(4_000_000);
  });
  it("clamps every Wan expand side to 100% of the matching source dimension", () => {
    expect(
      clampExtension(
        512,
        717,
        { left: 900, right: 513, top: 900, bottom: 718 },
        limits,
      ),
    ).toEqual({ left: 512, right: 512, top: 717, bottom: 717 });
  });
  it("converts screen drags at different window and zoom sizes", () => {
    for (const [stageWidth, stageHeight, zoom] of [
      [1200, 800, 0.62],
      [650, 600, 0.62],
      [900, 700, 1.2],
    ]) {
      const view = {
        stageWidth: stageWidth!,
        stageHeight: stageHeight!,
        imageWidth: 1024,
        imageHeight: 1536,
        zoom: zoom!,
        panX: 45,
        panY: -30,
        rotation: 0,
      };
      const before = imageToScreen(0, 0, view),
        after = imageToScreen(512, 256, view);
      expect(
        screenDeltaToImageDelta(after.x - before.x, displayScale(view)),
      ).toBeCloseTo(512);
      expect(screenToImage(after.x, after.y, view).y).toBeCloseTo(256);
    }
  });
  it.each(["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const)(
    "recognizes and moves %s handle",
    (edge) => {
      const view = {
        stageWidth: 1000,
        stageHeight: 800,
        imageWidth: 400,
        imageHeight: 300,
        zoom: 0.62,
        panX: 0,
        panY: 0,
        rotation: 0,
      };
      const f = toFrame(400, 300, { left: 80, right: 80, top: 60, bottom: 60 });
      const x = edge.includes("w") ? -80 : edge.includes("e") ? 480 : 200;
      const y = edge.includes("n") ? -60 : edge.includes("s") ? 360 : 150;
      const p = imageToScreen(x, y, view);
      expect(outpaintGesture(p.x, p.y, f, 400, 300, view)).toBe(edge);
      const next = resizeOutpaint(
        f,
        edge,
        edge.includes("w") ? -30 : 30,
        edge.includes("n") ? -20 : 20,
        400,
        300,
      );
      expect(next.width).toBe(
        edge.includes("e") || edge.includes("w") ? 590 : 560,
      );
      expect(next.height).toBe(
        edge.includes("n") || edge.includes("s") ? 440 : 420,
      );
    },
  );
});
