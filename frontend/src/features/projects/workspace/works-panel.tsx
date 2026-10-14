import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { useEffect, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { assetContentPath, listImageGenerations, type GenerationTask } from "../image-generation";
import { deleteWork } from "../asset-deletion";
import { userFacingMessage } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "../../../components/ui/alert-dialog";

export function WorksPanel({ projectId, kind, history, onSelect, onDelete, onRegenerate }: { projectId: string; kind: "image" | "video"; history: GenerationTask[]; onSelect: (id: string, items: GenerationTask[]) => void; onDelete: (ids: string[]) => void; onRegenerate?: (task: GenerationTask) => void }) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GenerationTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSelected([]); setError(""); setLoading(true);
    void (async () => {
      const all: GenerationTask[] = [];
      for (let offset = 0; ; offset += 20) {
        const page = await listImageGenerations(projectId, controller.signal, kind, offset);
        all.push(...page);
        if (page.length < 20) break;
      }
      if (!controller.signal.aborted) setItems(all);
    })().catch(reason => { if (!controller.signal.aborted) setError(userFacingMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, projectId, kind]);
  useEffect(() => { setOpen(false); }, [projectId, kind]);
  const merged = [...new Map([...items, ...history].map(item => [item.id, item])).values()];
  const ids = [...new Set(merged.flatMap(item => item.status === "succeeded" ? item.output_asset_ids : []))];
  async function copyAsset(id: string, image: boolean) {
    try {
      const url = new URL(assetContentPath(projectId, id), window.location.origin).href;
      if (image) {
        const png = (async () => {
          const response = await fetch(url, { credentials: "same-origin" });
          if (!response.ok) throw new Error("图片读取失败");
          const bitmap = await createImageBitmap(await response.blob());
          try {
            const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
            return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片转换失败")), "image/png"));
          } finally { bitmap.close(); }
        })();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      } else await navigator.clipboard.writeText(url);
      setFeedback(image ? "图像已复制" : "作品链接已复制（访问需要项目权限）");
    } catch { setError("复制失败，请检查浏览器剪贴板权限后重试。"); }
  }
  async function remove() {
    setBusy(true); setError("");
    const removed: string[] = [];
    let failures = 0;
    for (const id of selected) {
      try { await deleteWork(projectId, id); removed.push(id); } catch { failures++; }
    }
    setItems(current => current.map(item => ({ ...item, output_asset_ids: item.output_asset_ids.filter(id => !removed.includes(id)) })));
    onDelete(removed); setSelected(current => current.filter(id => !removed.includes(id)));
    setBusy(false); setConfirm(false);
    if (failures) setError(`${failures} 件作品删除失败，可重新尝试。`);
  }
  return <>
    <div className={`works-drawer ${open ? "is-open" : ""}`}>
    <button className="works-expand" aria-label={open ? "收起项目作品" : "展开项目作品"} aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}><ChevronLeft size={16} /></button>
    <section className="works-panel" aria-label="项目作品面板" aria-hidden={!open} inert={!open}>
      <header><div><strong>项目作品</strong><small>{kind === "image" ? "图片" : "视频"} · {ids.length} 件</small></div><button aria-label="收起项目作品" disabled={busy} onClick={() => setOpen(false)}><X size={20} /></button></header>
      <div className="works-batch"><label><input type="checkbox" disabled={busy || !ids.length} checked={ids.length > 0 && selected.length === ids.length} onChange={e => setSelected(e.target.checked ? ids : [])} /> 全选</label><Button variant="outline" disabled={!selected.length || busy} onClick={() => setConfirm(true)}>删除已选 {selected.length || ""}</Button></div>
      {feedback && <p role="status">{feedback}</p>}{loading && <p role="status">正在加载全部作品…</p>}{error && <p role="alert">{error}</p>}
      <div className="works-grid">{ids.map(id => <div className={`works-tile ${selected.includes(id) ? "is-selected" : ""}`} key={id} onContextMenu={event => { event.preventDefault(); if (!busy) setMenu({ id, x: event.clientX, y: event.clientY }); }}><button disabled={busy} aria-label="选中作品" aria-pressed={selected.includes(id)} onKeyDown={event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ id, x: rect.left, y: rect.top }); } }} onClick={() => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}>{kind === "image" ? <img alt="" loading="lazy" src={assetContentPath(projectId, id)} /> : <video muted preload="metadata" src={assetContentPath(projectId, id)} />}</button><input aria-label="选择作品" type="checkbox" disabled={busy} checked={selected.includes(id)} onChange={e => setSelected(current => e.target.checked ? [...current, id] : current.filter(value => value !== id))} /></div>)}</div>
      {!loading && !ids.length && <p>暂无作品</p>}
    </section>
    </div>
    <DropdownMenu open={menu !== null} onOpenChange={value => { if (!value) setMenu(null); }}>
      <DropdownMenuTrigger aria-label="作品操作菜单" style={{ position: "fixed", left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} tabIndex={-1} />
      <DropdownMenuContent className="works-context-menu" side="bottom" align="start" sideOffset={0}>
        <DropdownMenuItem onSelect={() => { if (menu) { onSelect(menu.id, merged); setOpen(false); } }}>在主画布中查看</DropdownMenuItem>
        {kind === "image" && <DropdownMenuItem onSelect={() => { if (menu) void copyAsset(menu.id, true); }}>复制图像</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => { if (menu) void copyAsset(menu.id, false); }}>复制作品链接</DropdownMenuItem>
        <DropdownMenuItem disabled={!onRegenerate} onSelect={() => { const task = merged.find(item => item.output_asset_ids.includes(menu?.id ?? "")); if (task) { onRegenerate?.(task); setOpen(false); } }}>使用提示词重新创作</DropdownMenuItem>
        <DropdownMenuItem className="works-context-danger" onSelect={() => { if (menu) { setSelected([menu.id]); setConfirm(true); } }}>删除作品</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog open={confirm} onOpenChange={value => { if (!busy) setConfirm(value); }}><AlertDialogContent><AlertDialogTitle>删除选中的 {selected.length} 件作品？</AlertDialogTitle><AlertDialogDescription className="work-delete-description">作品将从列表中移除，云端文件按系统设置处理。</AlertDialogDescription><div className="work-delete-actions"><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>取消</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? "正在删除…" : "确认删除"}</Button></div></AlertDialogContent></AlertDialog>
  </>;
}
