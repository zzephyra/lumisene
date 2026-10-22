import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { Inspector } from "./inspector";
import * as api from "./api";
vi.mock("./api", () => ({ detail: vi.fn(), save: vi.fn(), remove: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("switches details and saves with version without changing graph positions", async () => {
  const value = {
    id: "a",
    project_id: "p",
    name: "林夕",
    title: "编剧",
    role_type: "女主角",
    gender: "",
    age: "",
    occupation: "",
    version: 3,
    profile_data: { schema_version: 1 as const },
  };
  vi.mocked(api.detail).mockResolvedValue(value);
  vi.mocked(api.save).mockResolvedValue({
    ...value,
    title: "导演",
    version: 4,
  });
  const onSaved = vi.fn(),
    onClose = vi.fn(),
    onDirty = vi.fn(),
    onSelect = vi.fn();
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const graph = { characters: [], relationships: [], layout: { version: 0 } };
  const props = {
    projectId: "p",
    storyId: "s",
    selection: { kind: "character" as const, id: "a" },
    graph,
    onSaved,
    onClose,
    onDirty,
    onSelect,
  };
  const view = render(
    <QueryClientProvider client={query}>
      <Inspector {...props} />
    </QueryClientProvider>,
  );
  expect(await screen.findByDisplayValue("林夕")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "导演" },
  });
  await act(async () => {
    query.setQueryData(["projects", "p", "stories", "s", "character-detail", "character", "a"], { ...value, avatar_url: "/new-photo.png" });
  });
  expect(screen.getByLabelText("Title")).toHaveValue("导演");
  fireEvent.click(screen.getByText("保存"));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith(
      "p",
      "s",
      "character",
      expect.objectContaining({ title: "导演", expected_version: 3 }),
      "a",
    ),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  vi.mocked(api.detail).mockResolvedValue({ ...value, id: "b", name: "顾言" });
  view.rerender(
    <QueryClientProvider client={query}>
      <Inspector {...props} selection={{ kind: "character", id: "b" }} />
    </QueryClientProvider>,
  );
  expect(await screen.findByDisplayValue("顾言")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("关闭详情"));
  expect(onClose).toHaveBeenCalled();
});
