import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "../../lib/api";
import { ScriptAnalysis } from "./script-analysis";

vi.mock("../../lib/api", () => ({ apiRequest: vi.fn() }));
vi.mock("./api", () => ({ save: vi.fn(), remove: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps analysis inside a drawer and leaves the canvas free of the import banner", async () => {
  vi.mocked(apiRequest).mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ScriptAnalysis
        projectId="project-1"
        storyId="story-1"
        characters={[]}
        relationships={[]}
        canUndo={false}
        onUndo={() => undefined}
        onAccepted={() => undefined}
      />
    </QueryClientProvider>,
  );

  const entry = await screen.findByRole("button", { name: "AI 分析" });
  expect(entry.querySelector("span")).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByText("先导入文档，再使用 AI 分析生成人物关系")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(entry);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AI 人物分析" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始 AI 分析" })).toBeDisabled();
  expect(document.getElementById("graph-review-host")).toBeNull();
});
