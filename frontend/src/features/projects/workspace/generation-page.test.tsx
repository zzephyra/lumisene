import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationPage } from "./generation-page";
import { getEditorOptions, requestImageAction } from "../image-edit";
import { createImageGeneration, getActiveImageModel, listImageGenerations } from "../image-generation";

vi.mock("../../video-editor", () => ({ EditVideoButton: () => null, RecentEdits: () => null }));

vi.mock("../image-edit", () => ({
  getEditorOptions: vi.fn(),
  requestImageAction: vi.fn(),
}));

vi.mock("../image-generation", () => ({
  createImageGeneration: vi.fn(), getActiveImageModel: vi.fn(),
  listImageGenerations: vi.fn(), getImageGeneration: vi.fn(),
  assetContentPath: (project: string, asset: string) => `/assets/${project}/${asset}`,
}));
function Harness() {
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<"video" | "image">("video");
  return <GenerationPage projectId="project-a" generationType={type} setGenerationType={setType} prompt={prompt} setPrompt={setPrompt} />;
}
const unavailableVideo = {
  capability: "image_to_video",
  available: false,
  reason: "统一生成模型暂不支持此操作，请管理员检查图片或视频生成模型",
  model_name: null,
  resolutions: [] as string[],
  duration: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEditorOptions).mockResolvedValue([unavailableVideo]);
  vi.mocked(listImageGenerations).mockResolvedValue([]);
  vi.mocked(getActiveImageModel).mockResolvedValue({ id: "model-a", provider: "example", model_name: "example" });
  vi.mocked(createImageGeneration).mockResolvedValue({ id: "task-a", status: "succeeded", prompt: "test", kind: "video", output_asset_ids: [], error: null, allowed_actions: [] });
  vi.mocked(requestImageAction).mockResolvedValue({ id: "task-v", status: "queued", prompt: "一片森林", kind: "video", output_asset_ids: [], error: null, allowed_actions: [] });
});
describe("generation studio", () => {
  it("fills an example without submitting and preserves it until explicitly cleared", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "试用示例" }));
    expect((screen.getByRole("textbox", { name: /画面描述/ }) as HTMLTextAreaElement).value).toContain("旅人");
    expect(createImageGeneration).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "试用示例" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "清空画面描述" }));
    expect(screen.getByRole("textbox", { name: /画面描述/ })).toHaveValue("");
  });
  it("keeps the explicit video submission payload and supported parameters", async () => {
    render(<Harness />);
    expect(await screen.findByRole("button", { name: "5 秒" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "10 秒" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "9:16" }));
    await userEvent.type(screen.getByRole("textbox", { name: /画面描述/ }), "一片森林");
    await userEvent.click(screen.getByRole("button", { name: "生成视频" }));
    await waitFor(() => expect(createImageGeneration).toHaveBeenCalledWith("project-a", "一片森林", expect.any(String), { duration: 5, size: "1080*1920" }, "video"));
  });
  it("rejects unsupported references instead of silently ignoring them", async () => {
    render(
      <GenerationPage
        generationType="video"
        onClearReference={() => undefined}
        projectId="project-a"
        prompt="一片森林"
        referenceAsset={{ id: "up-1", name: "fluxora.png", url: "https://cdn.example/fluxora.png", size: 2.5 * 1024 * 1024, category: "image" }}
        setGenerationType={() => undefined}
        setPrompt={() => undefined}
      />,
    );
    expect(screen.getByText("fluxora.png")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB")).toBeInTheDocument();
    expect(screen.getByText(/请移除后使用文字生成/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加参考图片/ })).toBeDisabled();
    await userEvent.click(await screen.findByRole("button", { name: "生成视频" }));
    expect(createImageGeneration).not.toHaveBeenCalled();
    expect(requestImageAction).not.toHaveBeenCalled();
  });
  it("sends an added reference image to a video model that accepts images", async () => {
    vi.mocked(getEditorOptions).mockResolvedValue([
      {
        capability: "image_to_video",
        available: true,
        reason: null,
        model_name: "wan3.0-video",
        resolutions: ["720P", "1080P"],
        duration: 5,
      },
    ]);
    render(<Harness />);
    expect(await screen.findByText("PNG / JPG / WebP · 首帧")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加参考图片/ })).toBeEnabled();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "frame.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("上传视频参考图片"), file);
    await userEvent.type(screen.getByRole("textbox", { name: /画面描述/ }), "一片森林");
    await userEvent.click(screen.getByRole("button", { name: "生成视频" }));
    await waitFor(() => expect(requestImageAction).toHaveBeenCalledWith(
      "project-a",
      expect.objectContaining({ prompt: "一片森林", kind: "video", resolution: "720P", image: file }),
      expect.objectContaining({ inputId: expect.any(String), key: expect.any(String) }),
    ));
    expect(createImageGeneration).not.toHaveBeenCalled();
  });
  it("does not offer unsupported upload or submit without an assigned model", async () => {
    vi.mocked(getActiveImageModel).mockResolvedValue(null);
    render(<Harness />);
    expect(screen.getByRole("button", { name: /添加参考图片/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "图片生成" }));
    expect(screen.getByRole("button", { name: "生成图片 · 暂未开放" })).toBeDisabled();
    expect(createImageGeneration).not.toHaveBeenCalled();
  });
});

it("uploads a reference for image generation when the image model supports it", async () => {
  vi.mocked(getEditorOptions).mockResolvedValue([{ ...unavailableVideo, capability: "image_to_image", available: true, reason: null, model_name: "qwen-image-3.0" }]);
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "图片生成" }));
  await screen.findByText("PNG / JPG / WebP · 参考图");
  const file = new File(["png"], "reference.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText("上传图片参考图片"), file);
  expect(screen.getByText("图生图片")).toBeInTheDocument();
  await userEvent.type(screen.getByRole("textbox", { name: /画面描述/ }), "变为水彩画");
  await userEvent.click(screen.getByRole("button", { name: "生成图片" }));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledWith("project-a", expect.objectContaining({ image: file, kind: "image", prompt: "变为水彩画", parameters: expect.any(Object) }), expect.any(Object)));
  expect(createImageGeneration).not.toHaveBeenCalled();
});
