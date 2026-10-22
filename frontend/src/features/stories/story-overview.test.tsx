import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { graph } from "../character-graph/api";
import { listResources } from "../story-assets/api";
import { read } from "../storyline/api";
import type { Story } from "./api";
import { StoryOverview } from "./story-overview";

vi.mock("../character-graph/api", () => ({ graph: vi.fn() }));
vi.mock("../storyline/api", () => ({
  read: vi.fn(),
  plotRoot: (project: string, story: string) =>
    `/api/v1/projects/${project}/stories/${story}/plot`,
}));
vi.mock("../story-assets/api", () => ({ listResources: vi.fn() }));

const story: Story = {
  id: "story-1",
  project_id: "project-1",
  title: "第一集",
  description: null,
  cover_upload_id: null,
  cover_url: null,
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderOverview(value: Story = story) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onEdit = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StoryOverview projectId="project-1" story={value} onEdit={onEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onEdit };
}

it("opens the existing editor for an empty description and does not invent a status", async () => {
  vi.mocked(graph).mockResolvedValue({
    characters: [],
    relationships: [],
    layout: { version: 1, positions: {} },
  } as never);
  vi.mocked(read).mockResolvedValue({ version: 1, items: [] });
  vi.mocked(listResources).mockResolvedValue({
    items: [],
    total: 0,
    next_offset: null,
  });
  const user = userEvent.setup();
  const { onEdit } = renderOverview();

  await user.click(await screen.findByRole("button", { name: "添加故事简介" }));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(screen.queryByText("创作中")).not.toBeInTheDocument();
  expect(screen.queryByText("暂无介绍")).not.toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "编写剧情" })).toHaveAttribute(
    "href",
    "/projects/project-1/stories/story-1/plot",
  );
});

it("shows real counts and the latest chapter and resource", async () => {
  vi.mocked(graph).mockResolvedValue({
    characters: [
      {
        id: "c1",
        name: "林夏",
        title: "",
        role_type: "",
        age: "",
        occupation: "",
        summary: "",
        version: 1,
      },
      {
        id: "c2",
        name: "周野",
        title: "",
        role_type: "",
        age: "",
        occupation: "",
        summary: "",
        version: 1,
      },
    ],
    relationships: [],
    layout: { version: 1, positions: {} },
  } as never);
  vi.mocked(read).mockResolvedValue({
    version: 1,
    items: [
      {
        id: "chapter-1",
        title: "雨夜",
        summary: "",
        status: "draft",
        version: 1,
        order_index: 0,
        scene_count: 1,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-03T08:00:00Z",
      },
    ],
  });
  vi.mocked(listResources).mockResolvedValue({
    items: [
      {
        id: "asset-1",
        source: "upload",
        asset_id: null,
        upload_id: "upload-1",
        name: "咖啡馆",
        filename: "cafe.png",
        kind: "image",
        mime: "image/png",
        size: 10,
        width: null,
        height: null,
        duration_ms: null,
        created_at: "2026-10-04T09:30:00Z",
        references: [],
        direct_link_id: null,
        category: "general",
        preview_url: "/preview",
        thumbnail_url: null,
        can_delete: false,
      },
    ],
    total: 4,
    next_offset: null,
  });
  renderOverview({ ...story, description: "一场雨。" });

  expect(
    await screen.findByRole("link", { name: "人物关系 2" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "剧情 1" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "资源 4" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /雨夜/ })).toHaveAttribute(
    "href",
    "/projects/project-1/stories/story-1/plot",
  );
  expect(screen.getByRole("link", { name: /咖啡馆/ })).toHaveAttribute(
    "href",
    "/projects/project-1/stories/story-1/resources",
  );
  expect(screen.queryByText("林夏")).not.toBeInTheDocument();
});
