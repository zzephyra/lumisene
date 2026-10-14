import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ProfilePage } from "./profile-page";
import { getPublicWorks } from "./works-api";
vi.mock("../auth", () => ({ useSession: () => ({ data: { id: "author", email: "owner@example.com" } }), AccountMark: () => null }));
vi.mock("./works-api", () => ({ getPublicWorks: vi.fn(), publicContentPath: (user: string, id: string) => `/public/${user}/${id}` }));
beforeEach(() => vi.mocked(getPublicWorks).mockReset());
function renderPage() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ProfilePage projectId="project" /></MemoryRouter></QueryClientProvider>);
}
it("shows public images with reusable masonry and a visitor link", async () => {
  vi.mocked(getPublicWorks).mockResolvedValue([{ id: "work", kind: "image", width: 300, height: 500, published_at: "2026-10-13" }]);
  const { container } = renderPage();
  expect(await screen.findByRole("img", { name: "公开的图片作品" })).toHaveAttribute("src", "/public/author/work");
  expect(container.querySelector(".masonry-gallery")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "公开主页" })).toHaveAttribute("href", "/u/author");
  expect(getPublicWorks).toHaveBeenCalledWith("author", "image", 0, expect.any(AbortSignal));
});
it("switches to videos without retaining image content", async () => {
  vi.mocked(getPublicWorks).mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText("还没有公开的图片作品")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "视频" }));
  expect(await screen.findByText("还没有公开的视频作品")).toBeInTheDocument();
  expect(screen.queryByText("还没有公开的图片作品")).not.toBeInTheDocument();
});
