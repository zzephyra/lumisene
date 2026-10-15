import { useState } from "react";
import { Copy, Link as LinkIcon, Pencil } from "lucide-react";
import { Link } from "react-router";

export function MessageTools({ text, imageUrl, editUrl }: { text?: string; imageUrl?: string; editUrl?: string }) {
  const [feedback, setFeedback] = useState("");
  async function copy(image = false) {
    try {
      if (image && imageUrl) {
        const png = (async () => {
          const response = await fetch(imageUrl, { credentials: "same-origin" });
          if (!response.ok) throw new Error("读取失败");
          const bitmap = await createImageBitmap(await response.blob());
          try {
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width; canvas.height = bitmap.height;
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
            return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("转换失败")), "image/png"));
          } finally { bitmap.close(); }
        })();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      } else await navigator.clipboard.writeText(text ?? new URL(imageUrl!, location.origin).href);
      setFeedback("已复制");
    } catch { setFeedback("复制失败，请检查剪贴板权限"); }
  }
  return <><div className="message-tools" role="toolbar" aria-label={imageUrl ? "图片工具" : "文字工具"}>
    <button title={imageUrl ? "复制图片" : "复制文字"} aria-label={imageUrl ? "复制图片" : "复制文字"} onClick={() => void copy(!!imageUrl)}><Copy size={16} /></button>
    {imageUrl && <button title="复制图片地址" aria-label="复制图片地址" onClick={async () => { try { await navigator.clipboard.writeText(new URL(imageUrl!, location.origin).href); setFeedback("已复制地址"); } catch { setFeedback("复制失败"); } }}><LinkIcon size={16} /></button>}
    {imageUrl && text && <button title="复制文字" aria-label="复制文字" onClick={() => void copy()}><Copy size={16} /></button>}
    {editUrl && <Link to={editUrl} title="编辑图片" aria-label="编辑图片"><Pencil size={16} /></Link>}
  </div>{feedback && <small role="status">{feedback}</small>}</>;
}
