import type { OutpaintFrame } from "../types";
export type Extension = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type OutpaintLimits = {
  max_width: number;
  max_height: number;
  max_pixels: number;
};
export type OutpaintEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export const emptyExtension = (): Extension => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
export function calculateTargetSize(
  width: number,
  height: number,
  e: Extension,
) {
  return { width: width + e.left + e.right, height: height + e.top + e.bottom };
}
export function calculateOriginalOffset(e: Extension) {
  return { x: e.left, y: e.top };
}
export function screenDeltaToImageDelta(delta: number, scale: number) {
  return scale > 0 ? delta / scale : 0;
}
export function toFrame(
  width: number,
  height: number,
  e: Extension,
): OutpaintFrame {
  return {
    ...calculateTargetSize(width, height, e),
    imageX: e.left,
    imageY: e.top,
  };
}
export function fromFrame(
  width: number,
  height: number,
  f: OutpaintFrame,
): Extension {
  return {
    left: f.imageX,
    top: f.imageY,
    right: f.width - width - f.imageX,
    bottom: f.height - height - f.imageY,
  };
}
export function clampExtension(
  width: number,
  height: number,
  value: Extension,
  limits: OutpaintLimits,
): Extension {
  const clean = {
    left: Math.min(width, finitePixels(value.left)),
    right: Math.min(width, finitePixels(value.right)),
    top: Math.min(height, finitePixels(value.top)),
    bottom: Math.min(height, finitePixels(value.bottom)),
  };
  if (
    width > limits.max_width ||
    height > limits.max_height ||
    width * height > limits.max_pixels
  )
    return emptyExtension();
  const fits = (factor: number) => {
    const candidate = Object.fromEntries(
      Object.entries(clean).map(([k, v]) => [k, Math.floor(v * factor)]),
    ) as Extension;
    const size = calculateTargetSize(width, height, candidate);
    return {
      candidate,
      valid:
        size.width <= limits.max_width &&
        size.height <= limits.max_height &&
        size.width * size.height <= limits.max_pixels,
    };
  };
  if (fits(1).valid) return clean;
  let low = 0,
    high = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (fits(mid).valid) low = mid;
    else high = mid;
  }
  return fits(low).candidate;
}

function finitePixels(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
export function calculateAspectRatioExtension(
  width: number,
  height: number,
  ratio: number,
): Extension {
  const targetWidth = Math.max(width, Math.ceil(height * ratio));
  const targetHeight = Math.max(height, Math.ceil(width / ratio));
  const left = Math.floor((targetWidth - width) / 2),
    top = Math.floor((targetHeight - height) / 2);
  return {
    left,
    right: targetWidth - width - left,
    top,
    bottom: targetHeight - height - top,
  };
}
export function resizeOutpaint(
  frame: OutpaintFrame,
  edge: OutpaintEdge,
  dx: number,
  dy: number,
  width: number,
  height: number,
): OutpaintFrame {
  const e = fromFrame(width, height, frame);
  if (edge.includes("w")) e.left = Math.max(0, e.left - dx);
  if (edge.includes("e")) e.right = Math.max(0, e.right + dx);
  if (edge.includes("n")) e.top = Math.max(0, e.top - dy);
  if (edge.includes("s")) e.bottom = Math.max(0, e.bottom + dy);
  return toFrame(width, height, e);
}
export function outpaintMetadata(_width: number, _height: number, e: Extension) {
  return { left_offset: e.left, right_offset: e.right, top_offset: e.top, bottom_offset: e.bottom, best_quality: false };
}
