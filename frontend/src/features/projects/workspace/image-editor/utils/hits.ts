import type { CropRect, OutpaintFrame, ViewTransform } from "../types";
import { imageToScreen } from "./coordinates";

const HANDLE = 16;

export type CropGesture = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type OutpaintGesture = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export function cropGesture(x: number, y: number, rect: CropRect, view: ViewTransform): CropGesture | null {
  const corners = {
    nw: imageToScreen(rect.x, rect.y, view),
    ne: imageToScreen(rect.x + rect.width, rect.y, view),
    se: imageToScreen(rect.x + rect.width, rect.y + rect.height, view),
    sw: imageToScreen(rect.x, rect.y + rect.height, view),
  };
  const middles = {
    n: imageToScreen(rect.x + rect.width / 2, rect.y, view),
    e: imageToScreen(rect.x + rect.width, rect.y + rect.height / 2, view),
    s: imageToScreen(rect.x + rect.width / 2, rect.y + rect.height, view),
    w: imageToScreen(rect.x, rect.y + rect.height / 2, view),
  };
  const order = ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const;
  for (const edge of order) {
    const point = edge === "nw" || edge === "ne" || edge === "se" || edge === "sw" ? corners[edge] : middles[edge];
    if (Math.hypot(point.x - x, point.y - y) <= HANDLE) {
      return edge;
    }
  }
  const topLeft = corners.nw;
  const bottomRight = corners.se;
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
    return "move";
  }
  return null;
}

export function outpaintGesture(
  x: number,
  y: number,
  frame: OutpaintFrame,
  _imageWidth: number,
  _imageHeight: number,
  view: ViewTransform,
): OutpaintGesture | null {
  const left = -frame.imageX;
  const top = -frame.imageY;
  for (const [edge, cx, cy] of [["nw", left, top], ["ne", left + frame.width, top], ["sw", left, top + frame.height], ["se", left + frame.width, top + frame.height]] as const) {
    const point = imageToScreen(cx, cy, view);
    if (Math.hypot(point.x - x, point.y - y) <= HANDLE) return edge;
  }
  const edges = [
    ["w", imageToScreen(left, top, view), imageToScreen(left, top + frame.height, view)],
    ["e", imageToScreen(left + frame.width, top, view), imageToScreen(left + frame.width, top + frame.height, view)],
    ["n", imageToScreen(left, top, view), imageToScreen(left + frame.width, top, view)],
    ["s", imageToScreen(left, top + frame.height, view), imageToScreen(left + frame.width, top + frame.height, view)],
  ] as const;
  for (const [edge, start, end] of edges) {
    if (distanceToSegment(x, y, start.x, start.y, end.x, end.y) <= HANDLE) {
      return edge;
    }
  }
  return null;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  if (length === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
