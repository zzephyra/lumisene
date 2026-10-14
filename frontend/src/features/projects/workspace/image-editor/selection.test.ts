import { describe, expect, it } from "vitest";

import type { ViewTransform } from "./types";
import { imageToScreen, screenToImage, zoomAt } from "./utils/coordinates";
import { clampSelection, moveSelection, resizeSelection } from "./utils/selection";

const view: ViewTransform = {
  stageWidth: 800,
  stageHeight: 600,
  imageWidth: 400,
  imageHeight: 200,
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
};

describe("inpaint rectangle selection", () => {
  it("normalizes a drag from any direction and rejects a sliver", () => {
    expect(clampSelection({ x: 80, y: 60, width: -40, height: -20 }, 400, 200)).toEqual({
      x: 40,
      y: 40,
      width: 40,
      height: 20,
    });
    expect(clampSelection({ x: 10, y: 10, width: 4, height: 40 }, 400, 200)).toBeNull();
  });

  it("keeps the rectangle inside the image while moving and resizing", () => {
    const rect = { x: 360, y: 160, width: 30, height: 30 };
    expect(moveSelection(rect, 40, 40, 400, 200)).toEqual({ x: 370, y: 170, width: 30, height: 30 });
    expect(resizeSelection({ x: 20, y: 20, width: 40, height: 30 }, "nw", -10, -8, 400, 200)).toEqual({
      x: 10,
      y: 12,
      width: 50,
      height: 38,
    });
    expect(resizeSelection({ x: 0, y: 0, width: 40, height: 30 }, "n", 0, -20, 400, 200)?.y).toBe(0);
  });

  it("maps the same image pixels after zoom, pan, and rotation", () => {
    const rect = { x: 40, y: 20, width: 80, height: 40 };
    const zoomed = zoomAt({ ...view, panX: 24, panY: -12 }, 1.4, 300, 220);
    const turned = { ...zoomed, rotation: 90 };
    for (const point of [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y + rect.height],
    ]) {
      const screen = imageToScreen(point[0], point[1], turned);
      const image = screenToImage(screen.x, screen.y, turned);
      expect(image.x).toBeCloseTo(point[0]);
      expect(image.y).toBeCloseTo(point[1]);
    }
  });
});
