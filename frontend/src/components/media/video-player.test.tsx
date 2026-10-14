import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VideoPlayer } from "./video-player";
it("keeps actions separate and synchronizes seek and speed", () => {
  render(<VideoPlayer src="/clip.mp4" actions={<button>编辑视频</button>} />);
  const video = screen.getByLabelText("视频预览") as HTMLVideoElement;
  expect(video.controls).toBe(false);
  expect(screen.getByText("编辑视频").closest(".lumi-player-toolbar")).not.toBeNull();
  Object.defineProperty(video, "duration", { value: 65 });
  fireEvent.loadedMetadata(video);
  expect(screen.getByText("/ 1:05")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("播放进度"), { target: { value: "12" } });
  expect(video.currentTime).toBe(12);
  fireEvent.change(screen.getByLabelText("播放速度"), { target: { value: "1.5" } });
  expect(video.playbackRate).toBe(1.5);
});
it("handles playback rejection", async () => {
  render(<VideoPlayer src="/bad.mp4" />);
  const video = screen.getByLabelText("视频预览") as HTMLVideoElement;
  video.play = vi.fn().mockRejectedValue(new Error("unsupported"));
  fireEvent.click(screen.getByLabelText("播放视频"));
  expect(await screen.findByRole("alert")).toHaveTextContent("无法播放视频");
});
it("shows the full prompt on hover or focus and dismisses with Escape", () => {
  const prompt = "镜头缓缓推进，阳光穿过树叶，展现清晨森林的完整场景。";
  render(<VideoPlayer src="/clip.mp4" prompt={prompt} />);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(screen.getByText(prompt));
  expect(screen.getByRole("tooltip")).toHaveTextContent(prompt);
  fireEvent.mouseLeave(screen.getByRole("tooltip").parentElement!);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.focus(screen.getByText(prompt));
  expect(screen.getByRole("tooltip")).toHaveTextContent(prompt);
  fireEvent.keyDown(screen.getByText(prompt, { selector: "span" }), { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
