import Konva from "konva";
import { useEffect, useRef, useMemo } from "react";
import { Rect } from "react-konva";

import type { OutpaintFrame } from "./types";

export function OutpaintBackdrop({ frame, pending = false }: { frame: OutpaintFrame; pending?: boolean }) {
  const shape = useRef<Konva.Rect>(null);
  useEffect(() => {
    const node = shape.current;
    if (!node || !pending || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = new Konva.Animation((frame) => { node.opacity(.7 + .3 * Math.sin((frame?.time ?? 0) / 500)); }, node.getLayer());
    animation.start(); return () => { animation.stop(); node.opacity(1); };
  }, [pending]);
  const pattern = useMemo(() => checkerboard(), []);
  return (
    <Rect
      ref={shape}
      fillPatternImage={pattern as unknown as HTMLImageElement}
      height={frame.height}
      listening={false}
      width={frame.width}
      x={-frame.imageX}
      y={-frame.imageY}
    />
  );
}

export function OutpaintHandles({ frame, scale, originalWidth, originalHeight }: { frame: OutpaintFrame; scale: number; originalWidth: number; originalHeight: number }) {
  const left = -frame.imageX, top = -frame.imageY;
  const points = [[left, top], [left + frame.width / 2, top], [left + frame.width, top], [left + frame.width, top + frame.height / 2], [left + frame.width, top + frame.height], [left + frame.width / 2, top + frame.height], [left, top + frame.height], [left, top + frame.height / 2]];
  return <>
    <Rect x={0} y={0} width={originalWidth} height={originalHeight} stroke="rgba(255,255,255,.85)" strokeWidth={1.5 / scale} listening={false} />
    <Rect x={left} y={top} width={frame.width} height={frame.height} stroke="#d3f96b" strokeWidth={1 / scale} dash={[5 / scale, 4 / scale]} listening={false} />
    {points.map(([x, y], index) => <Rect key={index} x={x! - 3 / scale} y={y! - 3 / scale} width={6 / scale} height={6 / scale} cornerRadius={2 / scale} fill="#d3f96b" opacity={0.85} listening={false} />)}
  </>;
}

function checkerboard() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  context.fillStyle = "#121410";
  context.fillRect(0, 0, 16, 16);
  context.fillStyle = "#1d2118";
  context.fillRect(0, 0, 8, 8);
  context.fillRect(8, 8, 8, 8);
  return canvas;
}
