import type { ViewTransform } from "../types";

export const MIN_ZOOM = 0.85;
export const MAX_ZOOM = 1.75;
export const VIEW_PAD = { left: 28, right: 28, top: 20, bottom: 84 };

export function contentSize(view: ViewTransform): { width: number; height: number } {
  return {
    width: Math.max(1, view.stageWidth - VIEW_PAD.left - VIEW_PAD.right),
    height: Math.max(1, view.stageHeight - VIEW_PAD.top - (view.padBottom ?? VIEW_PAD.bottom)),
  };
}

export function fitScale(view: ViewTransform): number {
  if (view.imageWidth <= 0 || view.imageHeight <= 0) {
    return 1;
  }
  const box = contentSize(view);
  return Math.min(box.width / view.imageWidth, box.height / view.imageHeight);
}

function focalPoint(view: ViewTransform): { x: number; y: number } {
  const box = contentSize(view);
  return {
    x: VIEW_PAD.left + box.width / 2 + view.panX,
    y: VIEW_PAD.top + box.height / 2 + view.panY,
  };
}

export function displayScale(view: ViewTransform): number {
  return fitScale(view) * view.zoom;
}

export function fixedCropFrame(view: ViewTransform, ratio: number | null): { x: number; y: number; width: number; height: number } {
  const scale = fitScale(view);
  const box = contentSize(view);
  const visualWidth = view.imageWidth * scale;
  const visualHeight = view.imageHeight * scale;
  const baseX = VIEW_PAD.left + (box.width - visualWidth) / 2;
  const baseY = VIEW_PAD.top + (box.height - visualHeight) / 2;
  if (ratio === null || visualHeight <= 0) {
    return { x: baseX, y: baseY, width: visualWidth, height: visualHeight };
  }
  const current = visualWidth / visualHeight;
  if (current > ratio) {
    const width = visualHeight * ratio;
    return { x: baseX + (visualWidth - width) / 2, y: baseY, width, height: visualHeight };
  }
  const height = visualWidth / ratio;
  return { x: baseX, y: baseY + (visualHeight - height) / 2, width: visualWidth, height };
}

export function imageCropFromFrame(
  view: ViewTransform,
  frame: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const topLeft = screenToImage(frame.x, frame.y, view);
  const bottomRight = screenToImage(frame.x + frame.width, frame.y + frame.height, view);
  const left = Math.min(topLeft.x, bottomRight.x);
  const top = Math.min(topLeft.y, bottomRight.y);
  const right = Math.max(topLeft.x, bottomRight.x);
  const bottom = Math.max(topLeft.y, bottomRight.y);
  const x = Math.min(view.imageWidth, Math.max(0, left));
  const y = Math.min(view.imageHeight, Math.max(0, top));
  const x2 = Math.min(view.imageWidth, Math.max(0, right));
  const y2 = Math.min(view.imageHeight, Math.max(0, bottom));
  return { x, y, width: Math.max(1, x2 - x), height: Math.max(1, y2 - y) };
}

export function imageToScreen(x: number, y: number, view: ViewTransform): { x: number; y: number } {
  const scale = displayScale(view);
  const dx = x - view.imageWidth / 2;
  const dy = y - view.imageHeight / 2;
  const rad = (view.rotation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const focal = focalPoint(view);
  return {
    x: focal.x + rx * scale,
    y: focal.y + ry * scale,
  };
}

export function screenToImage(x: number, y: number, view: ViewTransform): { x: number; y: number } {
  const scale = displayScale(view) || 1;
  const focal = focalPoint(view);
  const dx = (x - focal.x) / scale;
  const dy = (y - focal.y) / scale;
  const rad = (-view.rotation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return {
    x: rx + view.imageWidth / 2,
    y: ry + view.imageHeight / 2,
  };
}

export function clampPan(view: ViewTransform, panX: number, panY: number): { panX: number; panY: number } {
  const scale = displayScale({ ...view, panX: 0, panY: 0 });
  const box = contentSize(view);
  const visualWidth = view.imageWidth * scale;
  const visualHeight = view.imageHeight * scale;
  const limitX = Math.abs(visualWidth - box.width) / 2 + box.width * 0.35;
  const limitY = Math.abs(visualHeight - box.height) / 2 + box.height * 0.35;
  return {
    panX: Math.min(limitX, Math.max(-limitX, panX)),
    panY: Math.min(limitY, Math.max(-limitY, panY)),
  };
}

export function zoomAt(view: ViewTransform, nextZoom: number, screenX: number, screenY: number): ViewTransform {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const anchor = screenToImage(screenX, screenY, view);
  const zoomed = { ...view, zoom };
  const moved = imageToScreen(anchor.x, anchor.y, zoomed);
  return {
    ...zoomed,
    panX: zoomed.panX + (screenX - moved.x),
    panY: zoomed.panY + (screenY - moved.y),
  };
}

export function screenBrushWidth(imageWidth: number, view: ViewTransform): number {
  return imageWidth * displayScale(view);
}
