import type { CropRect } from "../types";

export const MIN_SELECTION = 8;

export function clampSelection(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
  minimum = MIN_SELECTION,
): CropRect | null {
  const left = Math.min(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const right = Math.max(rect.x, rect.x + rect.width);
  const bottom = Math.max(rect.y, rect.y + rect.height);
  const x1 = Math.max(0, Math.min(imageWidth, left));
  const y1 = Math.max(0, Math.min(imageHeight, top));
  const x2 = Math.max(0, Math.min(imageWidth, right));
  const y2 = Math.max(0, Math.min(imageHeight, bottom));
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < minimum || height < minimum) {
    return null;
  }
  return { x: x1, y: y1, width, height };
}

export function moveSelection(rect: CropRect, dx: number, dy: number, imageWidth: number, imageHeight: number): CropRect {
  return {
    ...rect,
    x: Math.min(Math.max(0, rect.x + dx), Math.max(0, imageWidth - rect.width)),
    y: Math.min(Math.max(0, rect.y + dy), Math.max(0, imageHeight - rect.height)),
  };
}

export function resizeSelection(
  rect: CropRect,
  handle: string,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
): CropRect | null {
  let x1 = rect.x;
  let y1 = rect.y;
  let x2 = rect.x + rect.width;
  let y2 = rect.y + rect.height;
  if (handle.includes("w")) {
    x1 += dx;
  }
  if (handle.includes("e")) {
    x2 += dx;
  }
  if (handle.includes("n")) {
    y1 += dy;
  }
  if (handle.includes("s")) {
    y2 += dy;
  }
  return clampSelection({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, imageWidth, imageHeight, 1);
}
