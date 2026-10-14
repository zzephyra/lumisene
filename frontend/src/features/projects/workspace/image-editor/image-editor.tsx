import { RotateCcw, RotateCw, Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import useImage from "use-image";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { isApiError } from "../../../../lib/api";
import { requestErase } from "../../image-edit";
import { BrushSettings } from "./brush-settings";
import { EditorCanvas } from "./editor-canvas";
import { useCrop } from "./hooks/use-crop";
import { useEditorHistory } from "./hooks/use-editor-history";
import { useEditorTransform } from "./hooks/use-editor-transform";
import { ASPECT_PRESETS, type CropRect, type EditorTool, type MaskMode, type Stroke } from "./types";
import { useOutpaint } from "./hooks/use-outpaint";
import { OutpaintToolbar } from "./outpaint-toolbar";
import { fixedCropFrame, imageCropFromFrame } from "./utils/coordinates";
import { downloadBlob, exportImage, type ImageMime } from "./utils/export-image";
import { exportMask } from "./utils/export-mask";


import { GenerationAction, type ImageAction } from "./generation-action";
import type { GenerationTask } from "../../image-generation";

export function ImageEditor({ src, projectId, originalPrompt = "", onResult }: { src: string; projectId: string; originalPrompt?: string; onResult: (task: GenerationTask, apply?: boolean) => void }) {
  const [action, setAction] = useState<ImageAction | null>(null);
  const [objectUrl, setObjectUrl] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [image] = useImage(objectUrl);
  const [stage, setStage] = useState({ width: 1, height: 1 });
  const [tool, setTool] = useState<EditorTool>("view");
  const [maskMode, setMaskMode] = useState<MaskMode>("brush");
  const [inpaintMode, setInpaintMode] = useState<"box" | "brush">("box");
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [brushSize, setBrushSize] = useState(40);
  const [prompt] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useEditorHistory(image ?? null, image?.naturalWidth ?? 0, image?.naturalHeight ?? 0);
  const transform = useEditorTransform();
  const documentState = history.documentState;
  const outpaint = useOutpaint(projectId, src, documentState, originalPrompt, (task) => { setTool("view"); transform.resetView(); onResult(task, true); });
  const crop = useCrop();
  const hasSelection = selection !== null || documentState?.strokes.some((stroke) => stroke.mode === "add") === true;

  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    setLoadFailed(false);
    setObjectUrl("");
    // Cloud assets authenticate with signed URLs, not application cookies.
    // Including credentials rejects common CDN CORS responses (Allow-Origin: *).
    fetch(src, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("load");
        }
        url = URL.createObjectURL(await response.blob());
        if (!controller.signal.aborted) {
          setObjectUrl(url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
        }
      });
    return () => {
      controller.abort();
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [src]);

  useEffect(() => {
    setSelection(null);
  }, [src, documentState?.width, documentState?.height]);

  useEffect(() => { setTool("view"); setAction(null); }, [src]);

  const baseView = transform.viewFor(
    stage.width,
    stage.height,
    documentState?.width ?? 1,
    documentState?.height ?? 1,
  );
  // Fit stays tied to the original. The frame grows around it and must not rescale those pixels.
  const view = tool === "outpaint" ? { ...baseView, zoom: baseView.zoom * 0.62, padBottom: 200 } : baseView;
  const onStageSize = useCallback((width: number, height: number) => {
    setStage({ width, height });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (tool === "outpaint") return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          history.redo();
        } else {
          history.undo();
        }
      }
      if (tool === "erase" || tool === "inpaint") {
        if (event.key.toLowerCase() === "b") {
          setMaskMode("brush");
        }
        if (event.key.toLowerCase() === "e") {
          setMaskMode("eraser");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, tool]);

  function selectTool(next: EditorTool) {
    if (outpaint.pending) return;
    setNotice(null);
    if (tool === next) {
      setTool("view");
      return;
    }
    setTool(next);
    if (next === "crop") {
      crop.chooseRatio(null);
      transform.resetView();
    }
    if (next === "outpaint" && documentState) {
      transform.resetView();
      outpaint.reset();
    }
  }

  function commitStroke(stroke: Stroke) {
    history.commit(stroke.mode === "remove" ? { type: "mask-remove", payload: stroke } : { type: "mask-add", payload: stroke });
  }

  async function saveImage(mime: ImageMime) {
    if (!documentState) {
      return;
    }
    const blob = await exportImage(documentState.source, documentState.width, documentState.height, mime);
    const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
    downloadBlob(blob, `lumi.${extension}`);
  }

  async function saveMask() {
    if (!documentState) {
      return;
    }
    downloadBlob(await exportMask(documentState.width, documentState.height, documentState.strokes), "lumi-mask.png");
  }

  async function submitErase() {
    if (!documentState) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await requestErase({
        image: await exportImage(documentState.source, documentState.width, documentState.height, "image/png"),
        mask: await exportMask(documentState.width, documentState.height, documentState.strokes),
      });
    } catch (error) {
      setNotice(isApiError(error) ? error.message : "消除没有完成");
    } finally {
      setBusy(false);
    }
  }

  async function submitInpaint(rect: CropRect | null = selection) {
    if (busy || !documentState || !(rect || hasSelection)) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      setAction({
        kind: "image",
        selection: rect ? { x: rect.x / documentState.width, y: rect.y / documentState.height, width: rect.width / documentState.width, height: rect.height / documentState.height } : undefined,
        image: await exportImage(documentState.source, documentState.width, documentState.height, "image/png"),
        mask: await exportMask(documentState.width, documentState.height, documentState.strokes, rect),
        prompt: prompt.trim(),
      });
    } catch (error) {
      setNotice(isApiError(error) ? error.message : "局部重绘没有完成");
    } finally {
      setBusy(false);
    }
  }

  if (loadFailed) {
    return <p className="image-editor-note">图片没有载入</p>;
  }
  if (!image || !documentState) {
    return null;
  }

  return (
    <div className="image-editor">
      {action && <GenerationAction projectId={projectId} input={action} onClose={() => setAction(null)} onResult={(task, apply) => { setAction(null); onResult(task, apply); }} />}
      <EditorCanvas
        brushSize={brushSize}
        cropRatio={crop.ratio}
        documentState={documentState}
        maskMode={maskMode}
        onOutpaint={outpaint.setFrame}
        locked={outpaint.pending}
        onSelection={(rect) => { setSelection(rect); if (rect) void submitInpaint(rect); }}
        selection={selection}
        selectionMode={inpaintMode}
        onPan={(dx, dy) => transform.panBy(view, dx, dy)}
        onResetView={transform.resetView}
        onStageSize={onStageSize}
        onStroke={commitStroke}
        onZoom={(factor, x, y) => transform.zoomBy(view, factor, x, y)}
        outpaint={tool === "outpaint" ? outpaint.frame : null}
        tool={tool}
        view={view}
      />
      <div className="image-editor-top" inert={tool === "outpaint"}>
        <button onClick={() => history.commit({ type: "rotate", payload: { degrees: -90 } })} type="button">
          <RotateCcw size={15} aria-hidden="true" />向左旋转
        </button>
        <button onClick={() => history.commit({ type: "rotate", payload: { degrees: 90 } })} type="button">
          <RotateCw size={15} aria-hidden="true" />向右旋转
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="image-editor-menu"><Download size={15} aria-hidden="true" />导出</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void saveImage("image/png")}>PNG</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void saveImage("image/jpeg")}>JPEG</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void saveImage("image/webp")}>WebP</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void saveMask()}>导出 Mask</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {notice ? <p className="image-editor-note" role="status">{notice}</p> : null}
      <div className="image-editor-dock">
      {tool === "inpaint" ? (
        <div className="image-editor-ratios">
          <button aria-pressed={inpaintMode === "box"} onClick={() => setInpaintMode("box")} type="button">框选区域</button>
          <button className={hasSelection ? "image-editor-confirm" : undefined} disabled={!hasSelection || busy} onClick={() => void submitInpaint()} type="button">输入重绘内容</button>
          <button aria-pressed={inpaintMode === "brush"} onClick={() => setInpaintMode("brush")} type="button">精细选区</button>
          <button onClick={() => { setSelection(null); setInpaintMode("box"); }} type="button">重新框选</button>
          <button disabled={selection === null} onClick={() => setSelection(null)} type="button">清除选区</button>
        </div>
      ) : null}
      {tool === "erase" || (tool === "inpaint" && inpaintMode === "brush") ? (
        <BrushSettings brushSize={brushSize} mode={maskMode} onBrushSize={setBrushSize} onMode={setMaskMode} />
      ) : null}
      {tool === "outpaint" && <OutpaintToolbar state={outpaint} onCancel={() => setTool("view")} />}
      {tool === "crop" && <div className="image-editor-ratios">{ASPECT_PRESETS.map((preset) => <button key={preset.id} onClick={() => crop.chooseRatio(preset.ratio)} type="button">{preset.label}</button>)}<button onClick={() => setTool("view")} type="button">取消</button><button className="image-editor-confirm" onClick={() => { const rect = imageCropFromFrame(view, fixedCropFrame(view, crop.ratio)); history.commit({ type: "crop", payload: rect }); transform.resetView(); setTool("view"); }} type="button">确认裁剪</button></div>}
      {tool !== "outpaint" && <div className="image-editor-toolbar" role="toolbar" aria-label="图片编辑">
        <button disabled={busy} onClick={() => {
          setBusy(true);
          void exportImage(documentState.source, documentState.width, documentState.height, "image/png")
            .then(image => setAction({ image, prompt: "", kind: "video" }))
            .catch(() => setNotice("图片导出失败，请重试"))
            .finally(() => setBusy(false));
        }} type="button">生成视频</button>
        <button aria-pressed={tool === "inpaint"} onClick={() => selectTool("inpaint")} type="button">局部重绘</button>
        <button disabled={!outpaint.available} title={outpaint.reason ?? undefined} aria-pressed={false} onClick={() => selectTool("outpaint")} type="button">扩图</button>
        <button aria-pressed={tool === "erase"} onClick={() => selectTool("erase")} type="button">消除笔</button>
        <button disabled title="画质增强尚未开放" type="button">画质增强</button>
        <button aria-pressed={tool === "crop"} onClick={() => selectTool("crop")} type="button">裁剪</button>
        <button disabled={!history.canUndo} onClick={history.undo} type="button">撤销</button>
        <button disabled={!history.canRedo} onClick={history.redo} type="button">重做</button>
        <button onClick={transform.resetView} type="button">恢复居中</button>
        <button
          onClick={() => {
            history.reset();
            transform.resetView();
            setTool("view");
            setNotice(null);
          }}
          type="button"
        >
          重置
        </button>
        {tool === "erase" ? (
          <button disabled={busy || documentState.strokes.length === 0} onClick={() => void submitErase()} type="button">
            消除
          </button>
        ) : null}
        {tool === "erase" || (tool === "inpaint" && inpaintMode === "brush") ? (
          <button
            disabled={documentState.strokes.length === 0}
            onClick={() => history.commit({ type: "mask-clear", payload: null })}
            type="button"
          >
            清空蒙版
          </button>
        ) : null}
      </div>}
      </div>
    </div>
  );
}
