import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Workspace } from "./workspace";
import { creativePresets } from "./presets";
import type { Project } from "../types";
vi.mock("../../auth", () => ({ AccountMenu: () => <button>账户菜单</button>, useSession: () => ({ data: { id: "owner" } }) }));
vi.mock("../../chat/api", () => ({ listConversations: vi.fn().mockResolvedValue([]), listTurns: vi.fn().mockResolvedValue([]) }));
vi.mock("../../profile", () => ({ ProfilePage: () => <h1>个人主页</h1> }));
const project: Project = { id: "11111111-1111-4111-8111-111111111111", name: "远行计划", role: "OWNER", kind: "standard", version: 1, created_at: "2026-09-27", updated_at: "2026-09-27" };
function setup(suffix = "") {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/projects/${project.id}${suffix}`]}><Routes><Route path="/projects/:projectId/*" element={<Workspace project={project} />} /></Routes></MemoryRouter></QueryClientProvider>);
  return user;
}
describe("Workspace", () => {
  it("fills a preset without sending a message automatically", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: /把灵感写成故事/ }));
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue(creativePresets[0].prompt);
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("fills a world-building draft from a concept reference card", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: /去往，未被定义的世界/ }));
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue(creativePresets[2].prompt);
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveFocus();
    expect(screen.getByText("概念参考 · 点击带入创作需求")).toBeInTheDocument();
  });
  it("highlights the current route and keeps the draft when browsing within a project", async () => {
    const user = setup();
    const nav = screen.getByRole("navigation", { name: "工作区导航" });
    await user.type(screen.getByRole("textbox", { name: "创作需求" }), "只属于本项目的灵感");
    await user.click(within(nav).getByRole("link", { name: "资产" }));
    expect(within(nav).getByRole("link", { name: "资产" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "创作" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: "资产" })).toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: "创作" }));
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue("只属于本项目的灵感");
  });
  it("keeps the workspace frame and replaces only the main area on the profile route", () => {
    setup("/profile");
    expect(screen.getByRole("heading", { name: "个人主页" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "账户菜单" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "你好，今天想创作什么？" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "把想象，交给画面。" })).not.toBeInTheDocument();
  });

  it("supports direct generation routes and clearly disables unavailable submission", async () => {
    const user = setup("/generation");
    await user.click(screen.getByRole("button", { name: "图片生成" }));
    expect(screen.getByRole("button", { name: "图片生成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /生成图片 · 暂未开放/ })).toBeDisabled();
    expect(screen.queryByLabelText("生成模型")).not.toBeInTheDocument();
  });
  it("clears local state when the project-keyed workspace changes", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/projects/${project.id}`]}><Workspace key={project.id} project={project} /></MemoryRouter></QueryClientProvider>);
    await user.type(screen.getByRole("textbox", { name: "创作需求" }), "项目一的私人草稿");
    // Mirrors ProjectEntryPage's key boundary; no state is copied between projects.
    rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/projects/${project.id}`]}><Workspace key="another-project-instance" project={project} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue("");
  });

  it("requires confirmation before clearing a draft", async () => {
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "创作需求" }), "不要丢失");
    await user.click(screen.getByRole("button", { name: "新建草稿" }));
    await user.click(screen.getByRole("button", { name: "保留草稿" }));
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue("不要丢失");
    await user.click(screen.getByRole("button", { name: "新建草稿" }));
    await user.click(screen.getByRole("button", { name: "清空并新建" }));
    expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue("");
  });
});
