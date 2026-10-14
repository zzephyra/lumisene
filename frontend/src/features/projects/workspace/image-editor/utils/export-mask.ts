import type { CropRect, Stroke } from "../types";

function trace(context: CanvasRenderingContext2D, stroke: Stroke) {
  const [startX, startY] = stroke.points;
  if (startX === undefined || startY === undefined) {
    return;
  }
  context.beginPath();
  context.moveTo(startX, startY);
  for (let index = 2; index < stroke.points.length; index += 2) {
    context.lineTo(stroke.points[index] ?? startX, stroke.points[index + 1] ?? startY);
  }
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  if (stroke.points.length === 2) {
    context.fillStyle = context.strokeStyle;
    context.beginPath();
    context.arc(startX, startY, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  }
}

export function renderMask(
  width: number,
  height: number,
  strokes: Stroke[],
  selection?: CropRect | null,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (selection && selection.width > 0 && selection.height > 0) {
    context.fillStyle = "#fff";
    context.fillRect(selection.x, selection.y, selection.width, selection.height);
  }
  for (const stroke of strokes) {
    context.save();
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = stroke.mode === "remove" ? "#000" : "#fff";
    trace(context, stroke);
    context.restore();
  }
  return canvas;
}

export function exportMask(
  width: number,
  height: number,
  strokes: Stroke[],
  selection?: CropRect | null,
): Promise<Blob> {
  const canvas = renderMask(width, height, strokes, selection);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("蒙版导出失败"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
