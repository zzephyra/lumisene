import { resizeOutpaint, type OutpaintEdge } from "./utils/outpaint";
import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage } from "react-konva";

import { BrushCursor } from "./brush-cursor";
import { CropTool } from "./crop-tool";
import { useMask } from "./hooks/use-mask";
import { MaskLayer } from "./mask-layer";
import { OutpaintBackdrop, OutpaintHandles } from "./outpaint-tool";
import type { CropRect, EditorDocument, EditorTool, MaskMode, OutpaintFrame, Stroke, ViewTransform } from "./types";
import { displayScale, fixedCropFrame, imageToScreen, screenToImage } from "./utils/coordinates";
import { cropGesture, outpaintGesture } from "./utils/hits";
import { clampSelection, moveSelection, resizeSelection } from "./utils/selection";

type Drag =
  | { kind: "pan"; x: number; y: number }
  | { kind: "paint" }
  | { kind: "select-new"; origin: { x: number; y: number } }
  | { kind: "select-move"; x: number; y: number; rect: CropRect }
  | { kind: "select-resize"; handle: string; x: number; y: number; rect: CropRect }
  | { kind: "outpaint-edge"; edge: OutpaintEdge; x: number; y: number; frame: OutpaintFrame };

export function EditorCanvas({
  documentState,
  locked = false,
  view,
  tool,
  maskMode,
  brushSize,
  cropRatio,
  outpaint,
  selection,
  selectionMode,
  onSelection,
  onStroke,
  onPan,
  onZoom,
  onOutpaint,
  onStageSize,
  onResetView,
}: {
  documentState: EditorDocument;
  locked?: boolean;
  view: ViewTransform;
  tool: EditorTool;
  maskMode: MaskMode;
  brushSize: number;
  cropRatio: number | null;
  outpaint: OutpaintFrame | null;
  selection: CropRect | null;
  selectionMode: "box" | "brush";
  onSelection: (rect: CropRect | null) => void;
  onStroke: (stroke: Stroke) => void;
  onPan: (dx: number, dy: number) => void;
  onZoom: (factor: number, x: number, y: number) => void;
  onOutpaint: (frame: OutpaintFrame) => OutpaintFrame;
  onStageSize: (width: number, height: number) => void;
  onResetView: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const cursorShape = useRef<Konva.Circle>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [draft, setDraftState] = useState<CropRect | null>(null);
  const draftRef = useRef<CropRect | null>(null);
  const boxSelect = tool === "inpaint" && selectionMode === "box";
  const painting = (tool === "erase" || tool === "inpaint") && !boxSelect;
  const setDraft = (rect: CropRect | null) => {
    draftRef.current = rect;
    setDraftState(rect);
  };
  const liveView = { ...view, stageWidth: size.width, stageHeight: size.height };
  const mask = useMask(liveView, maskMode, brushSize, onStroke, painting);
  const space = useRef(false);
  const api = useRef({
    tool,
    locked,
    liveView,
    outpaint,
    painting,
    boxSelect,
    selection,
    documentState,
    brushSize,
    mask,
    onSelection,
    onPan,
    onZoom,
    onOutpaint,
    onResetView,
  });
  api.current = {
    tool,
    locked,
    liveView,
    outpaint,
    painting,
    boxSelect,
    selection,
    documentState,
    brushSize,
    mask,
    onSelection,
    onPan,
    onZoom,
    onOutpaint,
    onResetView,
  };

  useEffect(() => {
    const node = host.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const bounds = node.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      setSize({ width, height });
      onStageSize(width, height);
    });
    observer.observe(node);
    const bounds = node.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    setSize({ width, height });
    onStageSize(width, height);
    return () => observer.disconnect();
  }, [onStageSize]);

  useEffect(() => {
    const node = host.current;
    if (!node) {
      return;
    }
    let drag: Drag | null = null;

    const pointOf = (event: PointerEvent) => {
      const bounds = node.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const placeCursor = (x: number, y: number) => {
      const circle = cursorShape.current;
      const current = api.current;
      if (!circle) {
        return;
      }
      circle.radius(Math.max((current.brushSize * displayScale(current.liveView)) / 2, 1));
      circle.position({ x, y });
      circle.visible(current.painting);
      circle.getLayer()?.batchDraw();
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const point = pointOf(event);
      const current = api.current;
      if (current.locked) return;
      node.setPointerCapture(event.pointerId);
      if (space.current || current.tool === "view" || current.tool === "pan" || current.tool === "crop") {
        drag = { kind: "pan", ...point };
        node.classList.add("is-dragging");
        return;
      }
      if (current.boxSelect) {
        const imagePoint = screenToImage(point.x, point.y, current.liveView);
        const hit = current.selection ? cropGesture(point.x, point.y, current.selection, current.liveView) : null;
        if (hit === "move" && current.selection) {
          drag = { kind: "select-move", ...point, rect: current.selection };
        } else if (hit && current.selection) {
          drag = { kind: "select-resize", handle: hit, ...point, rect: current.selection };
        } else {
          drag = { kind: "select-new", origin: imagePoint };
          setDraft({ x: imagePoint.x, y: imagePoint.y, width: 0, height: 0 });
        }
        return;
      }
      if (current.painting) {
        drag = { kind: "paint" };
        current.mask.start(point.x, point.y);
        placeCursor(point.x, point.y);
        return;
      }
      if (current.tool === "outpaint" && current.outpaint) {
        const hit = outpaintGesture(
          point.x,
          point.y,
          current.outpaint,
          current.documentState.width,
          current.documentState.height,
          current.liveView,
        );
        if (hit) drag = { kind: "outpaint-edge", edge: hit, ...point, frame: current.outpaint };
      }
    };
    const onMove = (event: PointerEvent) => {
      const point = pointOf(event);
      const current = api.current;
      if (current.painting) {
        placeCursor(point.x, point.y);
      }
      if (current.locked) { drag = null; return; }
      if (!drag) {
        if (current.tool === "outpaint" && current.outpaint) {
          const hit = outpaintGesture(point.x, point.y, current.outpaint, current.documentState.width, current.documentState.height, current.liveView);
          node.style.cursor = hit ? outpaintCursor(hit) : "default";
        }
        return;
      }
      if (drag.kind === "pan") {
        current.onPan(point.x - drag.x, point.y - drag.y);
        drag = { kind: "pan", ...point };
        return;
      }
      if (drag.kind === "paint") {
        current.mask.move(point.x, point.y);
        return;
      }
      if (drag.kind === "select-new") {
        const imagePoint = screenToImage(point.x, point.y, current.liveView);
        setDraft({
          x: drag.origin.x,
          y: drag.origin.y,
          width: imagePoint.x - drag.origin.x,
          height: imagePoint.y - drag.origin.y,
        });
        return;
      }
      if (drag.kind === "select-move" || drag.kind === "select-resize") {
        const before = screenToImage(drag.x, drag.y, current.liveView);
        const after = screenToImage(point.x, point.y, current.liveView);
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const next = drag.kind === "select-move"
          ? moveSelection(drag.rect, dx, dy, current.documentState.width, current.documentState.height)
          : resizeSelection(drag.rect, drag.handle, dx, dy, current.documentState.width, current.documentState.height);
        if (next) {
          setDraft(next);
          drag = { ...drag, ...point, rect: next };
        }
        return;
      }
      const before = screenToImage(drag.x, drag.y, current.liveView);
      const after = screenToImage(point.x, point.y, current.liveView);
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const resized = resizeOutpaint(drag.frame, drag.edge, dx, dy, current.documentState.width, current.documentState.height);
      const frame = current.onOutpaint(resized);
      drag = { kind: "outpaint-edge", edge: drag.edge, ...point, frame };
    };
    const finish = (event: PointerEvent) => {
      const current = api.current;
      current.mask.end();
      if (drag?.kind === "select-new" && event.type === "pointerup") {
        const next = draftRef.current
          ? clampSelection(draftRef.current, current.documentState.width, current.documentState.height)
          : null;
        current.onSelection(next);
      }
      if ((drag?.kind === "select-move" || drag?.kind === "select-resize") && event.type === "pointerup" && draftRef.current) {
        current.onSelection(draftRef.current);
      }
      setDraft(null);
      drag = null;
      node.classList.remove("is-dragging");
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = node.getBoundingClientRect();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const limited = Math.max(-48, Math.min(48, delta));
      const factor = Math.min(1.04, Math.max(0.96, Math.exp(-limited * 0.001)));
      api.current.onZoom(factor, event.clientX - bounds.left, event.clientY - bounds.top);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      space.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        space.current = false;
      }
    };
    const reset = () => api.current.onResetView();
    node.addEventListener("pointerdown", onDown, true);
    node.addEventListener("pointermove", onMove, true);
    node.addEventListener("pointerup", finish, true);
    node.addEventListener("pointercancel", finish, true);
    node.addEventListener("dblclick", reset);
    node.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      node.removeEventListener("pointerdown", onDown, true);
      node.removeEventListener("pointermove", onMove, true);
      node.removeEventListener("pointerup", finish, true);
      node.removeEventListener("pointercancel", finish, true);
      node.removeEventListener("dblclick", reset);
      node.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const scale = displayScale(liveView);
  const placed = imageToScreen(liveView.imageWidth / 2, liveView.imageHeight / 2, liveView);

  return (
    <div className={`image-editor-stage tool-${tool}${boxSelect ? " is-box" : ""}${locked ? " is-outpaint-loading" : ""}`} ref={host}>
      <Stage height={size.height} width={size.width}>
        <Layer>
          <Group
            offsetX={documentState.width / 2}
            offsetY={documentState.height / 2}
            rotation={view.rotation}
            scaleX={scale}
            scaleY={scale}
            x={placed.x}
            y={placed.y}
          >
            {tool === "outpaint" && outpaint ? <OutpaintBackdrop frame={outpaint} pending={locked} /> : null}
            <KonvaImage
              height={documentState.height}
              image={documentState.source}
              listening={false}
              width={documentState.width}
            />
            {tool !== "outpaint" && <MaskLayer draftRef={mask.draft} strokes={documentState.strokes} />}
            {boxSelect ? <SelectionFrame imageHeight={documentState.height} imageWidth={documentState.width} rect={draft ?? selection} scale={scale || 1} /> : null}
            {tool === "outpaint" && outpaint ? <OutpaintHandles frame={outpaint} scale={scale || 1} originalWidth={documentState.width} originalHeight={documentState.height} /> : null}
          </Group>
          {tool === "crop" ? <CropTool rect={fixedCropFrame(liveView, cropRatio)} /> : null}
          {painting ? <BrushCursor radius={(brushSize * scale) / 2} ref={cursorShape} /> : null}
        </Layer>
      </Stage>
    </div>
  );
}

function outpaintCursor(edge: OutpaintEdge) {
  if (edge === "n" || edge === "s") return "ns-resize";
  if (edge === "e" || edge === "w") return "ew-resize";
  if (edge === "nw" || edge === "se") return "nwse-resize";
  return "nesw-resize";
}

function SelectionFrame({
  rect,
  imageWidth,
  imageHeight,
  scale,
}: {
  rect: CropRect | null;
  imageWidth: number;
  imageHeight: number;
  scale: number;
}) {
  if (!rect || rect.width === 0 || rect.height === 0) {
    return null;
  }
  const left = Math.min(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  const stroke = Math.max(1 / scale, 0.5);
  const handle = 8 / scale;
  const handles = [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
    [left + width / 2, top],
    [left + width, top + height / 2],
    [left + width / 2, top + height],
    [left, top + height / 2],
  ];
  return (
    <>
      <Rect fill="rgba(0,0,0,0.45)" height={top} listening={false} width={imageWidth} x={0} y={0} />
      <Rect fill="rgba(0,0,0,0.45)" height={Math.max(0, imageHeight - top - height)} listening={false} width={imageWidth} x={0} y={top + height} />
      <Rect fill="rgba(0,0,0,0.45)" height={height} listening={false} width={left} x={0} y={top} />
      <Rect fill="rgba(0,0,0,0.45)" height={height} listening={false} width={Math.max(0, imageWidth - left - width)} x={left + width} y={top} />
      <Rect height={height} listening={false} stroke="#d3f96b" strokeWidth={stroke} width={width} x={left} y={top} />
      {handles.map(([x, y]) => (
        <Rect fill="#d3f96b" height={handle} key={`${x}:${y}`} listening={false} width={handle} x={x - handle / 2} y={y - handle / 2} />
      ))}
    </>
  );
}
