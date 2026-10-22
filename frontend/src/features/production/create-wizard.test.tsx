import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { CreateProductionWizard } from "./create-wizard";
import { defaultSettings, newScene, read, change } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  read: vi.fn(),
  change: vi.fn(),
}));
vi.mock("./wizard-references", () => ({
  WizardReferences: () => <div>参考配置</div>,
}));
const production = () => ({
  id: "production",
  story_id: "story",
  title: "故事视频",
  version: 3,
  snapshot: { selection: [{ chapter_id: "chapter", scene_ids: null }] },
  settings: { ...defaultSettings, wizard_step: 5 },
  board: { visual_style: "", scenes: [newScene()] },
  runs: [],
  readiness: {
    allowed: true,
    billing: "no_generation",
    pending_shots: 0,
    message: "",
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(read).mockImplementation(async (path) => {
    if (path.endsWith("/capabilities")) return [] as never;
    if (path.includes("/source/"))
      return {
        chapters: [
          {
            id: "chapter",
            title: "第一章",
            text_length: 20,
            scenes: [],
            character_names: [],
          },
        ],
      } as never;
    return production() as never;
  });
  vi.mocked(change).mockImplementation(
    async () => ({ ...production(), version: 4 }) as never,
  );
});
function mount(initialProductionId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CreateProductionWizard
          projectId="project"
          storyId="story"
          storyTitle="故事"
          open
          onClose={vi.fn()}
          initialProductionId={initialProductionId}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
describe("制作向导的付费提交边界", () => {
  it("打开新向导不会创建媒体任务，未选择剧情不能继续", async () => {
    mount();
    await screen.findByText(/第一章/);
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
  });
  it("恢复最终步骤仍需要明确确认；保存确认后才调用故事范围 execute", async () => {
    mount("production");
    const confirm = await screen.findByRole("button", { name: "开始生成" });
    expect(confirm).toBeEnabled();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(vi.mocked(change).mock.calls[0][0]).toBe(
      "/api/v1/projects/project/stories/story/productions/production/board",
    );
    expect(vi.mocked(change).mock.calls[1][0]).toBe(
      "/api/v1/projects/project/stories/story/productions/production/execute",
    );
    expect(vi.mocked(change).mock.calls[1][2]).toMatchObject({
      expected_version: 4,
    });
  });
});

describe("AI 分镜反馈与载入", () => {
  function planningProduction(status: string, existing = false) {
    const scene = { ...newScene(), title: "AI 规划场景" };
    const value = {
      ...production(),
      settings: { ...defaultSettings, wizard_step: 4 },
      board: {
        visual_style: "",
        scenes: existing ? [{ ...newScene(), title: "人工场景" }] : [],
      },
      runs: [
        {
          id: "plan",
          kind: "plan",
          status,
          error: status === "failed" ? "The model provider timed out" : null,
          applied: false,
          result:
            status === "succeeded"
              ? { visual_style: "", scenes: [scene] }
              : null,
        },
      ],
    };
    const original = vi.mocked(read).getMockImplementation()!;
    vi.mocked(read).mockImplementation(async (path, signal) =>
      path.endsWith("/production") ? (value as never) : original(path, signal),
    );
  }
  it("首次规划成功后自动展示结果，无需手动载入或提交", async () => {
    planningProduction("succeeded");
    mount("production");
    await screen.findByText(/AI 规划场景/);
    expect(
      screen.queryByRole("button", { name: /载入最新规划预览/ }),
    ).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });
  it("重新规划不会覆盖已有分镜", async () => {
    planningProduction("succeeded", true);
    mount("production");
    await screen.findByText(/人工场景/);
    expect(screen.queryByText(/AI 规划场景/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /载入最新规划预览/ }));
    await screen.findByText(/AI 规划场景/);
    expect(change).not.toHaveBeenCalled();
  });
  it("规划期间显示进度，不展示误导性的空分镜提示", async () => {
    planningProduction("running");
    mount("production");
    await screen.findByText("AI 正在分析剧情并规划分镜");
    expect(
      screen.getByRole("button", { name: "正在规划分镜…" }),
    ).toBeDisabled();
    expect(screen.queryByText("还没有分镜")).not.toBeInTheDocument();
  });
  it("自动保存冲突时保留本地分镜，不自动覆盖远端", async () => {
    planningProduction("succeeded");
    vi.mocked(change).mockRejectedValue(
      new Error("其他位置已更新，请检查后重试"),
    );
    mount("production");
    await screen.findByText(/AI 规划场景/);
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toHaveTextContent("其他位置已更新");
    expect(screen.getByText(/AI 规划场景/)).toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(1);
  });
  it("超时用中文 Toast 提示，可关闭且不会因重渲染重复弹出", async () => {
    planningProduction("failed");
    mount("production");
    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("AI 分镜规划超时");
    expect(toast).toHaveClass("production-error-toast");
    expect(
      screen.queryByText("The model provider timed out"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

it("确认生成不显示费用或点数，也不要求费用授权", async () => {
  mount("production");
  expect(await screen.findByRole("button", { name: "开始生成" })).toBeEnabled();
  expect(screen.queryByText("预计费用")).not.toBeInTheDocument();
  expect(screen.queryByText("查看计费说明")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: /知悉费用/ }),
  ).not.toBeInTheDocument();
});
