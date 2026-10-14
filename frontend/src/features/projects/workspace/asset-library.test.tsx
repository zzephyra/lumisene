import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetLibrary } from "./asset-library";

type UploadRow = {
  localId: string;
  file: File;
  category: "image" | "video" | "file";
  status: "preparing" | "uploading" | "success" | "error" | "cancelled" | "idle";
  percent: number;
  message: string;
  record: null;
  task: { cancel: () => void } | null;
  phase: "idle" | "check" | "fade" | "ready";
};

type SavedRow = {
  id: string;
  key: string;
  url: string;
  original_filename: string;
  content_type: string;
  size: number;
  category: "image" | "video" | "file";
  status: "uploaded";
  provider: "qiniu";
  created_at: string;
  updated_at: string;
};

const uploadHarness = vi.hoisted(() => ({
  items: [] as UploadRow[],
  notice: null as { message: string; tone: "success" | "danger" } | null,
  removeLocal: vi.fn(),
  removeSaved: vi.fn(),
  retryAsset: vi.fn(),
  cancelAsset: vi.fn(),
  saved: {
    data: {
      items: [] as SavedRow[],
      limits: { image: 1, video: 1, file: 1 },
    },
    isError: false,
  },
  uploadAssets: vi.fn(),
}));

vi.mock("../../uploads", async () => {
  const actual = await vi.importActual<typeof import("../../uploads")>("../../uploads");
  return {
    ...actual,
    useUploadAssets: () => uploadHarness,
  };
});

vi.mock("../../auth", () => ({ useSession: () => ({ data: { id: "author" } }) }));

describe("asset upload entry", () => {
  beforeEach(() => {
    uploadHarness.items = [];
    uploadHarness.saved.data.items = [];
    uploadHarness.notice = null;
    uploadHarness.uploadAssets.mockClear();
    uploadHarness.cancelAsset.mockClear();
    uploadHarness.retryAsset.mockClear();
    uploadHarness.removeSaved.mockClear();
  });

  it("opens one dialog from the toolbar and drops files onto the workspace", async () => {
    const user = userEvent.setup();
    renderLibrary();
    expect(screen.queryByRole("heading", { name: "上传素材" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "暂无素材" })).toBeInTheDocument();
    const workspace = screen.getByRole("region", { name: "素材工作区" });
    const file = new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" });
    fireEvent.dragEnter(workspace, { dataTransfer: fileTransfer([file]) });
    expect(screen.getByText("松开以上传素材")).toBeInTheDocument();
    fireEvent.drop(workspace, { dataTransfer: fileTransfer([file]) });
    expect(uploadHarness.uploadAssets).toHaveBeenCalledWith([file]);

    await user.click(screen.getAllByRole("button", { name: "添加素材" })[0]);
    expect(screen.getByRole("heading", { name: "添加素材" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择文件" })).toBeInTheDocument();
  });

  it("centers a saved asset without an uploaded label and opens a preview", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    uploadHarness.saved.data.items = [savedImage()];
    renderLibrary(onGenerate);
    expect(screen.getByText("fluxora.png")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB")).toBeInTheDocument();
    expect(screen.queryByText(/已上传/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "生成" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ id: "file-1", name: "fluxora.png", category: "image" }));
    await user.click(screen.getByRole("button", { name: "生成" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "预览 fluxora.png" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "fluxora.png" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps an upload failure on the card and retries from there", async () => {
    const user = userEvent.setup();
    uploadHarness.items = [uploadRow({ status: "error", message: "网络连接失败" })];
    renderLibrary();
    const card = screen.getByText("上传失败").closest("article");
    expect(card).toHaveClass("is-error");
    expect(screen.getByText("网络连接失败")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新上传" }));
    expect(uploadHarness.retryAsset).toHaveBeenCalledWith("local-1");
  });

  it("shows upload progress in the card and can cancel", async () => {
    const user = userEvent.setup();
    uploadHarness.items = [uploadRow({ status: "uploading", percent: 46, category: "video", name: "clip.mp4" })];
    renderLibrary();
    expect(screen.getByText("正在上传")).toBeInTheDocument();
    expect(screen.getByText("46%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "clip.mp4 上传进度" })).toHaveAttribute("aria-valuenow", "46");
    expect(screen.queryByRole("button", { name: /预览/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消上传" }));
    expect(uploadHarness.cancelAsset).toHaveBeenCalledWith("local-1");
  });

  it("previews a saved video", async () => {
    const user = userEvent.setup();
    uploadHarness.saved.data.items = [savedImage({ category: "video", content_type: "video/mp4", original_filename: "clip.mp4", url: "https://cdn.example/clip.mp4" })];
    renderLibrary();
    await user.click(screen.getByRole("button", { name: "预览 clip.mp4" }));
    expect(screen.getByRole("dialog").querySelector("video")).toHaveAttribute("controls");
  });
});

function renderLibrary(onGenerate = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetLibrary
      assetSearch=""
      assetType="全部作品"
      onGenerate={onGenerate}
      setAssetSearch={() => undefined}
      setAssetType={() => undefined}
      setView={() => undefined}
      view="grid"
    /></QueryClientProvider>,
  );
}

function savedImage(overrides: Partial<SavedRow> = {}): SavedRow {
  return {
    id: "file-1",
    key: "uploads/image/file-1.png",
    url: "https://cdn.example/fluxora.png",
    original_filename: "fluxora.png",
    content_type: "image/png",
    size: 2.5 * 1024 * 1024,
    category: "image",
    status: "uploaded",
    provider: "qiniu",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function uploadRow(overrides: Partial<UploadRow> & { name?: string } = {}): UploadRow {
  const { name = "fluxora.png", ...rest } = overrides;
  const category = rest.category ?? "image";
  return {
    localId: "local-1",
    file: new File([new Uint8Array([1])], name, { type: category === "video" ? "video/mp4" : "image/png" }),
    category,
    status: "uploading",
    percent: 0,
    message: "",
    record: null,
    task: { cancel: vi.fn() },
    phase: "idle",
    ...rest,
  };
}

function fileTransfer(files: File[]) {
  return {
    files,
    types: ["Files"],
    dropEffect: "none",
  };
}
