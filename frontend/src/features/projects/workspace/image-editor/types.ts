export type EditorTool = "view" | "pan" | "crop" | "erase" | "inpaint" | "outpaint";

export type MaskMode = "brush" | "eraser";

export type Stroke = {
  id: string;
  mode: "add" | "remove";
  width: number;
  points: number[];
};

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OutpaintFrame = {
  width: number;
  height: number;
  imageX: number;
  imageY: number;
};

export type EditorAction =
  | { type: "mask-add"; payload: Stroke }
  | { type: "mask-remove"; payload: Stroke }
  | { type: "mask-clear"; payload: null }
  | { type: "crop"; payload: CropRect }
  | { type: "rotate"; payload: { degrees: 90 | -90 } }
  | { type: "outpaint"; payload: OutpaintFrame };

export type ViewTransform = {
  stageWidth: number;
  stageHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  padBottom?: number;
};

export type EditorDocument = {
  source: CanvasImageSource;
  width: number;
  height: number;
  strokes: Stroke[];
};

export const ASPECT_PRESETS = [
  { id: "free", label: "自由", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
] as const;

export type AspectPresetId = (typeof ASPECT_PRESETS)[number]["id"];
