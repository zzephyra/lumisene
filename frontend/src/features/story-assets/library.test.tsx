import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { StoryAssetLibrary } from "./library";
import type { LibraryAsset, LibraryPage } from "./api";

vi.mock("./api", () => ({
  libraryOptions: vi.fn(),
  listResources: vi.fn(),
  attachResource: vi.fn(),
  renameResource: vi.fn(),
  removeResource: vi.fn(),
  resourceText: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StoryAssetLibrary projectId="p" storyId="s" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function page(items: LibraryAsset[]): LibraryPage {
  return { items, total: items.length, next_offset: null };
}

function portrait(): LibraryAsset {
  return {
    id: "upload-1",
    source: "upload",
    asset_id: null,
    upload_id: "upload-1",
    name: "林夏",
    filename: "linxia.png",
    kind: "image",
    mime: "image/png",
    size: 128,
    width: null,
    height: null,
    duration_ms: null,
    created_at: "2026-10-17T00:00:00Z",
    references: [{ type: "character", id: "c1", name: "林夏", primary: true }],
    direct_link_id: null,
    category: "character",
    preview_url: "/preview",
    thumbnail_url: "/thumb",
    can_delete: false,
  };
}

it("shows an honest empty library and a character image without a story copy", async () => {
  vi.mocked(api.libraryOptions).mockResolvedValue({
    limits: { image: 20, video: 20, file: 20 },
    formats: { image: ["image/png"], video: [], document: [] },
  });
  vi.mocked(api.listResources).mockImplementation(async (_project, _story, query) =>
    page(query.category === "character" || query.category === "all" || !query.category ? [portrait()] : []),
  );
  const user = userEvent.setup();
  renderLibrary();
  expect(await screen.findAllByText("林夏")).toHaveLength(2);
  expect(screen.getByText("主图")).toBeInTheDocument();
  expect(screen.queryByText("还没有任何资源")).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "分镜" }));
  expect(await screen.findByText("暂无分镜素材")).toBeInTheDocument();
  expect(screen.getByText("当你创建分镜参考图后，它们会出现在这里。")).toBeInTheDocument();
  await waitFor(() =>
    expect(api.listResources).toHaveBeenCalledWith(
      "p",
      "s",
      expect.objectContaining({ category: "shot" }),
      expect.anything(),
    ),
  );
});
