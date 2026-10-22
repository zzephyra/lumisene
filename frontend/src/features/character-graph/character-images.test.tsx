import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import { uploadFile } from "../uploads";
import { useCharacterImages } from "./use-character-images";
import { CharacterImages } from "./character-images";
import type { Character } from "./api";
vi.mock("../../lib/api", () => ({ apiRequest: vi.fn() }));
vi.mock("../uploads", () => ({ uploadFile: vi.fn() }));
const person: Character = {
  id: "c",
  project_id: "p",
  name: "林夕",
  title: "",
  role_type: "",
  gender: "",
  age: "",
  occupation: "",
  version: 1,
};
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(apiRequest).mockResolvedValue({ images: [], jobs: [] });
});
function Harness() {
  const controller = useCharacterImages("p", "s", "c");
  return (
    <aside data-testid="drawer" {...controller.dropzone}>
      {controller.dragging && <div>松开上传</div>}
      <CharacterImages controller={controller} character={person} />
    </aside>
  );
}
describe("character visual assets", () => {
  it("provides AI generation in the empty state without a native file control", async () => {
    render(<Harness />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "AI 生成人物形象" }),
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("image-generations"),
          method: "POST",
          body: expect.objectContaining({
            mode: "candidate",
            profile: expect.objectContaining({ name: "林夕" }),
          }),
        }),
      ),
    );
  });
  it("keeps valid files uploading when a batch includes invalid files", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      id: "u",
      url: "https://example.test/image.png",
    } as Awaited<ReturnType<typeof uploadFile>>);
    render(<Harness />, { wrapper });
    await screen.findByRole("button", { name: "AI 生成人物形象" });
    const drawer = screen.getByTestId("drawer");
    const transfer = {
      types: ["Files"],
      files: [
        new File(["x"], "photo.png", { type: "image/png" }),
        new File(["x"], "bad.txt", { type: "text/plain" }),
      ],
    };
    fireEvent.dragEnter(drawer, { dataTransfer: transfer });
    fireEvent.dragEnter(drawer, { dataTransfer: transfer });
    fireEvent.dragLeave(drawer, { dataTransfer: transfer });
    expect(screen.getByText("松开上传")).toBeInTheDocument();
    fireEvent.drop(drawer, { dataTransfer: transfer });
    expect(screen.queryByText("松开上传")).not.toBeInTheDocument();
    await screen.findByText("已上传并保存");
    expect(
      screen.getByText("仅支持 20 MB 内 JPG、PNG、WebP"),
    ).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", body: { upload_id: "u" } }),
    );
  });
  it("finishes binding uploads after the drawer unmounts", async () => {
    let complete!: (value: Awaited<ReturnType<typeof uploadFile>>) => void;
    vi.mocked(uploadFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }) as ReturnType<typeof uploadFile>,
    );
    const view = renderHook(() => useCharacterImages("p", "s", "c"), {
      wrapper,
    });
    act(() =>
      view.result.current.upload([
        new File(["x"], "photo.png", { type: "image/png" }),
      ]),
    );
    view.unmount();
    await act(async () =>
      complete({ id: "u", url: "url" } as Awaited<
        ReturnType<typeof uploadFile>
      >),
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/v1/projects/p/stories/s/characters/c/images",
          body: { upload_id: "u" },
        }),
      ),
    );
  });
  it("opens a full preview and supports next-image keyboard navigation", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      images: [1, 2].map((i) => ({
        id: String(i),
        character_id: "c",
        image_url: `https://example.test/${i}.png`,
        is_primary: i === 1,
        source: "upload",
        created_at: "now",
      })),
      jobs: [],
    });
    render(<Harness />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "查看主要形象" }),
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByAltText("人物形象完整预览")).toHaveAttribute(
      "src",
      "https://example.test/2.png",
    );
  });
});
