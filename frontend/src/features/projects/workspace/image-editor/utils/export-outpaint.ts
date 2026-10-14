import type { EditorDocument, OutpaintFrame } from "../types";
import { fromFrame } from "./outpaint";

/** Send only the current original; expansion is generated entirely by the provider. */
export async function exportOutpaint(source: EditorDocument, frame: OutpaintFrame) {
  const scale = Math.max(1, 512 / Math.min(source.width, source.height));
  const width = Math.round(source.width * scale), height = Math.round(source.height * scale);
  if (Math.max(width, height) > 4096) throw new Error("扩图原图单边不能超过 4096 像素");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法导出原图");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source.source, 0, 0, width, height);
  const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("原图导出失败")), "image/png"));
  if (image.size > 10 * 1024 * 1024) throw new Error("扩图原图不能超过 10 MB，请先缩小图片");
  const e = fromFrame(source.width, source.height, frame);
  return { image, width, height, extension: {
    left: Math.round(e.left * scale), right: Math.round(e.right * scale),
    top: Math.round(e.top * scale), bottom: Math.round(e.bottom * scale),
  }};
}
