import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { StoriesPage } from "./stories-page";
import * as api from "./api";

vi.mock("./api", () => ({
  listStories: vi.fn(),
  createStory: vi.fn(),
  updateStory: vi.fn(),
  deleteStory: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/projects/p/stories"]}>
        <Routes>
          <Route
            path="/projects/:projectId/stories"
            element={<StoriesPage projectId="p" />}
          />
          <Route
            path="/projects/:projectId/stories/:storyId"
            element={<p>故事详情</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the empty state and keeps the form when creation fails", async () => {
  vi.mocked(api.listStories).mockResolvedValue({
    items: [],
    next_cursor: null,
  });
  vi.mocked(api.createStory).mockRejectedValue(new Error("保存没有完成"));
  const user = userEvent.setup();
  renderPage();
  expect(
    await screen.findByText("还没有故事，创建你的第一个故事。"),
  ).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "新建故事" })[0]);
  await user.click(screen.getByRole("button", { name: "创建" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请填写故事名称");
  await user.type(screen.getByRole("textbox", { name: "故事名称" }), "林夕");
  await user.click(screen.getByRole("button", { name: "创建" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存没有完成");
  expect(screen.getByRole("textbox", { name: "故事名称" })).toHaveValue("林夕");
});

it("opens a story from the card and confirms deletion separately", async () => {
  vi.mocked(api.listStories).mockResolvedValue({
    items: [
      {
        id: "s1",
        project_id: "p",
        title: "很长的故事名称不应该把卡片撑开",
        description: "第一行介绍\n第二行介绍\n第三行不应该完整出现在卡片里",
        cover_upload_id: null,
        cover_url: null,
        version: 2,
        created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z",
      },
    ],
    next_cursor: null,
  });
  vi.mocked(api.deleteStory).mockResolvedValue();
  const user = userEvent.setup();
  renderPage();
  const card = await screen.findByRole("link", { name: /很长的故事名称/ });
  expect(card.querySelector("h2")).toHaveClass("truncate");
  expect(card.querySelector("p")).toHaveClass("line-clamp-2");
  await user.click(
    screen.getByRole("button", {
      name: "很长的故事名称不应该把卡片撑开的操作",
    }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "删除" }));
  expect(screen.queryByText("故事详情")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() =>
    expect(api.deleteStory).toHaveBeenCalledWith("p", "s1", 2),
  );
});

it("shows an error and retries the list", async () => {
  vi.mocked(api.listStories)
    .mockRejectedValueOnce(new Error("失败"))
    .mockResolvedValue({ items: [], next_cursor: null });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "故事列表加载失败",
  );
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(
    await screen.findByText("还没有故事，创建你的第一个故事。"),
  ).toBeInTheDocument();
});
