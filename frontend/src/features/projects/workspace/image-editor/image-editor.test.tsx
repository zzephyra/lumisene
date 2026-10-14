import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { requestImageAction } from "../../image-edit";
import { ImageEditor } from "./image-editor";

vi.mock("use-image", () => ({
  default: () => [{ naturalWidth: 20, naturalHeight: 10 }],
}));

vi.mock("./editor-canvas", () => ({
  EditorCanvas: ({
    onSelection,
  }: {
    onSelection: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  }) => (
    <button type="button" onClick={() => onSelection({ x: 2, y: 2, width: 8, height: 4 })}>
      完成框选
    </button>
  ),
}));

vi.mock("./utils/export-image", () => ({
  exportImage: vi.fn(async () => new Blob(["image"])),
  downloadBlob: vi.fn(),
}));

vi.mock("./utils/export-mask", () => ({
  exportMask: vi.fn(async () => new Blob(["mask"])),
}));

vi.mock("../../image-edit", async () => {
  const actual = await vi.importActual<typeof import("../../image-edit")>("../../image-edit");
  return {
    ...actual,
    getEditorOptions: vi.fn(),
    requestImageAction: vi.fn(),
  };
});

vi.mock("../../image-generation", async () => {
  const actual = await vi.importActual<typeof import("../../image-generation")>("../../image-generation");
  return {
    ...actual,
    getImageGeneration: vi.fn(),
  };
});

const unsupported = "统一生成模型暂不支持此操作，请管理员检查图片或视频生成模型";

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ImageEditor projectId="project-a" src="/image.png" onResult={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["image"]) })),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    }),
  );
  const { getEditorOptions } = await import("../../image-edit");
  vi.mocked(getEditorOptions).mockResolvedValue([
    {
      capability: "image_inpaint",
      available: false,
      reason: unsupported,
      model_name: null,
      resolutions: [],
      duration: null,
    },
  ]);
});

it("opens the redraw prompt after boxing and again from the toolbar", async () => {
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "局部重绘" }));
  await userEvent.click(screen.getByRole("button", { name: "完成框选" }));
  expect(await screen.findByLabelText("创作描述")).toBeInTheDocument();
  expect(screen.getByText(unsupported)).toBeInTheDocument();
  expect(requestImageAction).not.toHaveBeenCalled();

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByLabelText("创作描述")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "输入重绘内容" }));
  expect(await screen.findByLabelText("创作描述")).toBeInTheDocument();
  expect(requestImageAction).not.toHaveBeenCalled();
});

it("loads signed cloud images without cross-origin cookies", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const src = "https://cdn.example.com/art.png?token=signed";
  render(<QueryClientProvider client={client}><ImageEditor projectId="project-a" src={src} onResult={vi.fn()} /></QueryClientProvider>);
  expect(fetch).toHaveBeenCalledWith(src, expect.objectContaining({ credentials: "same-origin", signal: expect.any(AbortSignal) }));
});
