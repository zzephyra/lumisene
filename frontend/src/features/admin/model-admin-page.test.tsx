import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { getMe } from "../auth/api";
import { assignModel, clearModelAssignment, createModelConfig, disableModelConfig, enableModelConfig, listModelAssignments, listModelCatalog, listModelConfigs } from "./api";
import { ASSIGNMENT_TOAST_MS, AssignmentScreen, CatalogScreen, ModelAdminPage } from "./model-admin-page";

import { ModelDetailsScreen } from "./model-details-page";
import { AdminOverview, AdminModuleScreen } from "./admin-overview";

vi.mock("./api", () => ({
  listModelConfigs: vi.fn(),
  listModelCatalog: vi.fn(),
  listModelAssignments: vi.fn(),
  assignModel: vi.fn(),
  clearModelAssignment: vi.fn(),
  createModelConfig: vi.fn(),
  disableModelConfig: vi.fn(),
  enableModelConfig: vi.fn(),
  modelAdminQueryKey: ["admin", "model-configs"],
  modelAssignmentQueryKey: ["admin", "model-assignments"],
}));

vi.mock("../auth/api", () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
  sessionQueryKey: ["auth", "session"],
}));

function renderPage(path = "/admin/models") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ModelAdminPage />} path="/admin">
            <Route index element={<AdminOverview />} />
            <Route element={<AdminModuleScreen />} path=":module" />
            <Route element={<CatalogScreen />} path="models" />
            <Route element={<ModelDetailsScreen />} path="models/details" />
            <Route element={<AssignmentScreen />} path="assignments" />
          </Route>
          <Route element={<h1>工作台</h1>} path="/studio" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("model admin page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.mocked(listModelConfigs).mockReset();
    vi.mocked(listModelCatalog).mockReset();
    vi.mocked(listModelCatalog).mockResolvedValue([]);
    vi.mocked(listModelAssignments).mockReset();
    vi.mocked(listModelAssignments).mockResolvedValue([]);
    vi.mocked(assignModel).mockReset();
    vi.mocked(clearModelAssignment).mockReset();
    vi.mocked(createModelConfig).mockReset();
    vi.mocked(disableModelConfig).mockReset();
    vi.mocked(enableModelConfig).mockReset();
    vi.mocked(getMe).mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      platform_admin: true,
    });
  });

  it("registers a model from details and then offers disable and enable for the same version", async () => {
    const config = { id: "video-1", provider: "wan", model_name: "wan3.0-video", capability: "text_to_video", config_version: 1, parameters_schema: {}, limits: {}, secret_ref: "wan", enabled: true };
    vi.mocked(listModelConfigs).mockResolvedValue([]);
    vi.mocked(listModelCatalog).mockResolvedValue([{ id: "wan", alias_zh: "万相", alias_en: "Wan", models: [{ name: "wan3.0-video", alias_zh: "万相 3.0", alias_en: "Wan 3", capabilities: ["text_to_video"], inputs: ["text", "image"], parameters: { durations: [5, 10] } }] }]);
    vi.mocked(createModelConfig).mockImplementation(async () => { vi.mocked(listModelConfigs).mockResolvedValue([config]); return config; });
    vi.mocked(disableModelConfig).mockImplementation(async () => { vi.mocked(listModelConfigs).mockResolvedValue([{ ...config, enabled: false }]); return { ...config, enabled: false }; });
    vi.mocked(enableModelConfig).mockImplementation(async () => { vi.mocked(listModelConfigs).mockResolvedValue([config]); return config; });
    renderPage("/admin/models/details?provider=wan&model=wan3.0-video");
    expect(await screen.findByRole("heading", { name: "图生视频" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "文生视频" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "登记模型" }));
    expect(createModelConfig).toHaveBeenCalledWith(expect.objectContaining({ provider: "wan", capability: "text_to_video" }));
    await userEvent.click(await screen.findByRole("button", { name: "停用" }));
    expect(disableModelConfig).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
    expect(disableModelConfig).toHaveBeenCalledWith("video-1");
    await userEvent.click(await screen.findByRole("button", { name: "启用" }));
    expect(enableModelConfig).toHaveBeenCalledWith("video-1");
    expect(await screen.findByRole("button", { name: "停用" })).toBeInTheDocument();
  });

  it("shows real empty catalog counts and navigates to the planned moderation module", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([]);
    renderPage("/admin/");
    expect(await screen.findByRole("heading", { name: "控制台总览" })).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "模型目录统计" });
    expect(within(stats).getAllByText("0")).toHaveLength(4);
    const nav = screen.getByRole("navigation", { name: "管理导航" });
    expect(within(nav).getByRole("link", { name: "控制台总览" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(nav).getByRole("link", { name: /内容审核/ }));
    expect(await screen.findByRole("heading", { name: "内容审核" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /内容审核/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("管理入口已就绪，业务能力待接入")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用用户" })).not.toBeInTheDocument();
  });

  it("guards planned modules with the existing server administrator check", async () => {
    vi.mocked(listModelConfigs).mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "Not found", details: {}, requestId: null }));
    renderPage("/admin/moderation");
    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "内容审核" })).not.toBeInTheDocument();
  });

  it("treats a non-admin response as an unknown page", async () => {
    vi.mocked(listModelConfigs).mockRejectedValue(
      new ApiError({
        status: 404,
        code: "not_found",
        message: "Not found",
        details: {},
        requestId: null,
      }),
    );
    renderPage();
    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记模型" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密钥名称")).not.toBeInTheDocument();
  });

  it("submits only the catalog fields", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([]);
    vi.mocked(listModelCatalog).mockResolvedValue([
      {
        id: "qianwen",
        alias_zh: "千问",
        alias_en: "Qianwen",
        models: [
          {
            name: "qwen-plus",
            alias_zh: "千问 Plus",
            alias_en: "Qwen Plus",
            capabilities: ["text_generation", "embedding"],
            inputs: [],
            parameters: {},
          },
        ],
      },
    ]);
    vi.mocked(createModelConfig).mockResolvedValue({
      id: "config-1",
      provider: "qianwen",
      model_name: "qwen-plus",
      capability: "text_generation",
      config_version: 1,
      parameters_schema: {},
      limits: {},
      secret_ref: "qianwen",
      enabled: true,
    });
    renderPage("/admin/models");
    expect(await screen.findByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.queryByLabelText("供应商")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "登记模型" }));
    expect(await screen.findByRole("heading", { name: "登记模型" })).toBeInTheDocument();
    expect(await screen.findByLabelText("供应商")).toHaveTextContent("千问 · qianwen");
    expect(screen.queryByLabelText("密钥名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("能力")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("文本生成")).toBeInTheDocument();
    expect(within(dialog).getByText("向量")).toBeInTheDocument();
    expect(within(dialog).queryByText(/密钥名称与供应商相同/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认登记" }));
    await waitFor(() => expect(createModelConfig).toHaveBeenCalledTimes(2));
    const payload = vi.mocked(createModelConfig).mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual([
      "capability",
      "limits",
      "model_name",
      "parameters_schema",
      "provider",
      "secret_ref",
    ]);
    expect(payload).not.toHaveProperty("api_key");
    expect(payload).toMatchObject({
      provider: "qianwen",
      model_name: "qwen-plus",
      capability: "text_generation",
      parameters_schema: {},
      secret_ref: "qianwen",
    });
    expect(vi.mocked(createModelConfig).mock.calls[1][0].capability).toBe("embedding");
  });

  it("disables a published config from the server list", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([
      {
        id: "config-1",
        provider: "openai",
        model_name: "gpt-4o",
        capability: "text_generation",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "openai_api_key",
        enabled: true,
      },
    ]);
    vi.mocked(disableModelConfig).mockResolvedValue({
      id: "config-1",
      provider: "openai",
      model_name: "gpt-4o",
      capability: "text_generation",
      config_version: 1,
      parameters_schema: {},
      limits: {},
      secret_ref: "openai_api_key",
      enabled: false,
    });
    renderPage("/admin/models");
    expect(await screen.findByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.queryByLabelText("供应商")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "gpt-4o 版本 1 操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "停用 gpt-4o 版本 1" }));
    expect(disableModelConfig).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(disableModelConfig).toHaveBeenCalled());
    expect(vi.mocked(disableModelConfig).mock.calls[0][0]).toBe("config-1");
  });

  it("restores a disabled config without treating it as permanent", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([
      {
        id: "config-1",
        provider: "openai",
        model_name: "gpt-4o",
        capability: "text_generation",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "openai_api_key",
        enabled: false,
      },
    ]);
    vi.mocked(enableModelConfig).mockResolvedValue({
      id: "config-1",
      provider: "openai",
      model_name: "gpt-4o",
      capability: "text_generation",
      config_version: 1,
      parameters_schema: {},
      limits: {},
      secret_ref: "openai_api_key",
      enabled: true,
    });
    renderPage("/admin/models");
    await screen.findByRole("heading", { name: "Models" });
    await userEvent.click(screen.getByRole("button", { name: "gpt-4o 版本 1 操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "恢复 gpt-4o 版本 1" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("停用时取消的业务指定不会自动恢复");
    expect(enableModelConfig).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(enableModelConfig).toHaveBeenCalled());
    expect(vi.mocked(enableModelConfig).mock.calls[0][0]).toBe("config-1");
    expect(disableModelConfig).not.toHaveBeenCalled();
  });

  it("shows only models of the same capability in a business", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([
      {
        id: "text-1",
        provider: "qianwen",
        model_name: "qwen-plus",
        capability: "text_generation",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "qianwen",
        enabled: true,
      },
      {
        id: "video-1",
        provider: "qianwen",
        model_name: "video-a",
        capability: "text_to_video",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "qianwen",
        enabled: true,
      },
      {
        id: "video-2",
        provider: "qianwen",
        model_name: "video-b",
        capability: "text_to_video",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "qianwen",
        enabled: false,
      },
    ]);
    renderPage("/admin/assignments");
    expect(await screen.findByRole("heading", { name: "业务指定" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记模型" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("视频"));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["qianwen · video-a"]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByLabelText("文本生成"));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["qianwen · qwen-plus"]);
  });

  it("shows success and failure after changing a business assignment", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([
      {
        id: "text-1",
        provider: "qianwen",
        model_name: "qwen-plus",
        capability: "text_generation",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "qianwen",
        enabled: true,
      },
    ]);
    vi.mocked(listModelAssignments).mockResolvedValue([
      {
        capability: "text_generation",
        model_config_id: "text-1",
        provider: "qianwen",
        model_name: "qwen-plus",
        config_version: 1,
      },
    ]);
    vi.mocked(clearModelAssignment).mockResolvedValue(undefined);
    vi.mocked(assignModel)
      .mockRejectedValueOnce(new Error("rejected"))
      .mockResolvedValueOnce({
        capability: "text_generation",
        model_config_id: "text-1",
        provider: "qianwen",
        model_name: "qwen-plus",
        config_version: 1,
      });
    renderPage("/admin/assignments");
    await screen.findByRole("button", { name: "取消指定" });
    const assign = screen.getAllByRole("button", { name: "设为当前模型" }).find((button) => !button.hasAttribute("disabled"));
    if (!assign) {
      throw new Error("expected an enabled assignment button");
    }
    await userEvent.click(assign);
    const failure = await screen.findByText("指定失败：无法连接服务器，请重试");
    expect(failure).toHaveClass("admin-toast");
    const assignAgain = screen.getAllByRole("button", { name: "设为当前模型" }).find((button) => !button.hasAttribute("disabled"));
    if (!assignAgain) {
      throw new Error("expected an enabled assignment button");
    }
    await userEvent.click(assignAgain);
    expect(await screen.findByText("已将文本生成指定为 qianwen · qwen-plus")).toHaveClass("admin-toast");
    expect(screen.queryByText("指定失败：无法连接服务器，请重试")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消指定" }));
    expect(await screen.findByText("已取消文本生成的指定")).toBeInTheDocument();
    expect(clearModelAssignment).toHaveBeenCalledWith("text_generation");
    await new Promise((resolve) => setTimeout(resolve, ASSIGNMENT_TOAST_MS + 50));
    expect(screen.queryByText("已取消文本生成的指定")).not.toBeInTheDocument();
  }, 10000);

  it("filters the catalog by capability tag and model name", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([
      {
        id: "text-1",
        provider: "qianwen",
        model_name: "qwen-plus",
        capability: "text_generation",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "qianwen",
        enabled: true,
      },
      {
        id: "video-1",
        provider: "qianwen",
        model_name: "video-a",
        capability: "text_to_video",
        config_version: 1,
        parameters_schema: {},
        limits: {},
        secret_ref: "qianwen",
        enabled: true,
      },
    ]);
    renderPage("/admin/models");
    expect(await screen.findByText("qwen-plus")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("搜索模型名称"), "plus");
    expect(screen.getByText("qwen-plus")).toBeInTheDocument();
    expect(screen.queryByText("video-a")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("搜索模型名称"));
    await userEvent.click(screen.getByRole("button", { name: "能力筛选" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "视频" }));
    expect(screen.getByText("video-a")).toBeInTheDocument();
    expect(screen.queryByText("qwen-plus")).not.toBeInTheDocument();
  });
  it("paginates and combines real provider and status filters", async () => {
    const configs = Array.from({ length: 12 }, (_, i) => ({
      id: `model-${i}`, provider: i < 10 ? "alpha" : "beta", model_name: `model-${i}`,
      capability: "text_generation", config_version: 1, parameters_schema: {}, limits: {},
      secret_ref: "server_key", enabled: i !== 11,
    }));
    vi.mocked(listModelConfigs).mockResolvedValue(configs);
    renderPage();
    await screen.findByRole("heading", { name: "Models" });
    const table = screen.getByRole("table", { name: "模型配置目录" });
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "供应商筛选" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "beta" }));
    await userEvent.click(screen.getByRole("button", { name: "状态筛选" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "已停用" }));
    expect(within(table).getByText("model-11")).toBeInTheDocument();
    expect(within(table).queryByText("model-10")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });

  it("registers the selected model's declared parameters", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([]);
    vi.mocked(listModelCatalog).mockResolvedValue([
      {
        id: "wan_video",
        alias_zh: "万相",
        alias_en: "Wan",
        models: [
          {
            name: "wan2.2-t2v-plus",
            alias_zh: "万相 2.2",
            alias_en: "Wan 2.2",
            capabilities: ["text_to_video"],
            inputs: ["text", "image", "video", "audio"],
            parameters: { resolutions: ["480P", "1080P"] },
          },
          {
            name: "wan2.1-i2v-turbo",
            alias_zh: "万相 2.1",
            alias_en: "Wan 2.1",
            capabilities: ["text_to_video"],
            inputs: [],
            parameters: { resolutions: ["480P"] },
          },
        ],
      },
    ]);
    vi.mocked(createModelConfig).mockResolvedValue({
      id: "config-1",
      provider: "wan_video",
      model_name: "wan2.1-i2v-turbo",
      capability: "text_to_video",
      config_version: 1,
      parameters_schema: { resolutions: ["480P"] },
      limits: {},
      secret_ref: "wan_video",
      enabled: true,
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "登记模型" }));
    expect(await screen.findByText("输入：文本、图片、视频、音频")).toBeInTheDocument();
    expect(await screen.findByText("清晰度：480P、1080P")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("模型"));
    await userEvent.click(screen.getByRole("menuitem", { name: "万相 2.1 · wan2.1-i2v-turbo" }));
    expect(screen.getByText("清晰度：480P")).toBeInTheDocument();
    expect(screen.queryByText(/输入：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1080P/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认登记" }));
    await waitFor(() => expect(createModelConfig).toHaveBeenCalled());
    expect(vi.mocked(createModelConfig).mock.calls[0][0].parameters_schema).toEqual({
      resolutions: ["480P"],
    });
  });

  it("shows a skeleton while loading and a retry after failure", async () => {
    vi.mocked(listModelConfigs).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole("status", { name: "正在加载模型目录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记模型" })).not.toBeInTheDocument();
  });

  it("retries a failed catalog request", async () => {
    vi.mocked(listModelConfigs).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue([]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("还没有登记模型")).toBeInTheDocument();
  });

  it("switches the admin theme and refreshes without changing data", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "切换至深色模式" }));
    expect(document.querySelector(".admin-shell")).toHaveAttribute("data-theme", "dark");
    await userEvent.click(screen.getByRole("button", { name: "刷新模型目录" }));
    await waitFor(() => expect(listModelConfigs).toHaveBeenCalledTimes(2));
    expect(createModelConfig).not.toHaveBeenCalled();
    expect(disableModelConfig).not.toHaveBeenCalled();
  });

  it("opens the mobile navigation as a keyboard-dismissable dialog", async () => {
    vi.mocked(listModelConfigs).mockResolvedValue([]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "打开管理导航" }));
    expect(screen.getByRole("dialog", { name: "管理导航" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

});
