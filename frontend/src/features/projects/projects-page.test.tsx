import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { getMe } from "../auth/api";
import { RequireSession } from "../auth";
import {
  createProject,
  ensurePersonalSpace,
  getProject,
  listProjects,
} from "./api";
import { ProjectEntryPage } from "./project-entry-page";
import { ProjectsPage } from "./projects-page";
import { StudioEntry } from "./studio-entry";

vi.mock("../auth/api", () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  sessionQueryKey: ["auth", "session"],
}));

vi.mock("./api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  ensurePersonalSpace: vi.fn(),
  projectListQueryKey: ["projects", "list"],
  personalSpaceQueryKey: ["projects", "personal"],
  projectDetailQueryKey: (projectId: string) => [
    "projects",
    projectId,
    "detail",
  ],
}));

const projectId = "11111111-1111-4111-8111-111111111111";

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<h1>登录</h1>} path="/login" />
          <Route
            element={
              <RequireSession>
                <StudioEntry />
              </RequireSession>
            }
            path="/studio"
          />
          <Route
            element={
              <RequireSession>
                <ProjectsPage />
              </RequireSession>
            }
            path="/projects"
          />
          <Route
            element={
              <RequireSession>
                <ProjectEntryPage />
              </RequireSession>
            }
            path="/projects/:projectId/*"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    localStorage.removeItem("lumi.sidebar.collapsed");
    vi.mocked(getMe).mockReset();
    vi.mocked(listProjects).mockReset();
    vi.mocked(listProjects).mockResolvedValue({ items: [], next_cursor: null });
    vi.mocked(getProject).mockReset();
    vi.mocked(createProject).mockReset();
    vi.mocked(ensurePersonalSpace).mockReset();
    vi.mocked(getMe).mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      platform_admin: false,
    });
  });

  it("shows an empty project list", async () => {
    vi.mocked(listProjects).mockResolvedValue({ items: [], next_cursor: null });
    renderAt("/projects");

    expect(
      await screen.findByRole("heading", { name: "还没有创作空间" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "创作空间" }),
    ).toBeInTheDocument();
  });

  it("shows a project returned by the API", async () => {
    vi.mocked(listProjects).mockResolvedValue({
      items: [
        {
          id: projectId,
          name: "春季成片",
          role: "OWNER",
          kind: "standard",
          version: 1,
          created_at: "2026-09-27T04:00:00Z",
          updated_at: "2026-09-27T04:00:00Z",
        },
      ],
      next_cursor: null,
    });
    renderAt("/projects");

    expect(
      await screen.findByRole("link", { name: /春季成片/ }),
    ).toHaveAttribute("href", `/projects/${projectId}`);
    expect(screen.getByText("所有者")).toBeInTheDocument();
  });

  it("opens only the project returned by create", async () => {
    const createdId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(listProjects).mockResolvedValue({
      items: [
        {
          id: projectId,
          name: "春季成片",
          role: "OWNER",
          kind: "standard",
          version: 1,
          created_at: "2026-09-27T04:00:00Z",
          updated_at: "2026-09-27T04:00:00Z",
        },
      ],
      next_cursor: null,
    });
    vi.mocked(createProject).mockResolvedValue({
      id: createdId,
      name: "新世界",
      role: "OWNER",
      kind: "standard",
      version: 1,
      created_at: "2026-09-27T05:00:00Z",
      updated_at: "2026-09-27T05:00:00Z",
    });
    vi.mocked(getProject).mockImplementation(async (id: string) => {
      if (id !== createdId) {
        throw new Error("requested another project");
      }
      return {
        id: createdId,
        name: "新世界",
        role: "OWNER",
        kind: "standard",
        version: 1,
        created_at: "2026-09-27T05:00:00Z",
        updated_at: "2026-09-27T05:00:00Z",
      };
    });
    const user = userEvent.setup();
    renderAt("/projects");

    await user.click(
      (await screen.findAllByRole("button", { name: "新建创作空间" }))[0],
    );
    expect(screen.getByText(/不会从其他创作空间带过来/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("创作空间名称"), "新世界");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByRole("link", { name: "创作" })).toHaveAttribute(
      "href",
      "/projects/22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByText(/这个创作空间和其他空间分开/)).toBeInTheDocument();
    expect(screen.queryByText("春季成片")).not.toBeInTheDocument();
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createProject).mock.calls[0]?.[0]).toBe("新世界");
  });

  it("shows an error and retries", async () => {
    vi.mocked(listProjects)
      .mockRejectedValueOnce(
        new ApiError({
          status: 503,
          code: "retrieval_unavailable",
          message: "down",
          details: {},
          requestId: "req-2",
        }),
      )
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    const user = userEvent.setup();
    renderAt("/projects");

    expect(
      await screen.findByRole("heading", { name: "无法加载创作空间" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByRole("heading", { name: "还没有创作空间" }),
    ).toBeInTheDocument();
  });

  it("opens the personal space when a project link does not exist", async () => {
    const personalId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(getProject).mockImplementation(async (id: string) => {
      if (id !== personalId) {
        throw new ApiError({
          status: 404,
          code: "not_found",
          message: "not found",
          details: {},
          requestId: "req-3",
        });
      }
      return {
        id: personalId,
        name: "个人空间",
        role: "OWNER",
        kind: "personal",
        version: 1,
        created_at: "2026-09-27T04:00:00Z",
        updated_at: "2026-09-27T04:00:00Z",
      };
    });
    vi.mocked(ensurePersonalSpace).mockResolvedValue({
      id: personalId,
      name: "个人空间",
      role: "OWNER",
      kind: "personal",
      version: 1,
      created_at: "2026-09-27T04:00:00Z",
      updated_at: "2026-09-27T04:00:00Z",
    });
    renderAt(`/projects/${projectId}`);

    expect(
      await screen.findByRole("heading", { name: "和 Lumi 一起开始创作" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "创作空间" }),
    ).not.toBeInTheDocument();
  });

  it("retries when the personal space cannot be opened", async () => {
    const personalId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(ensurePersonalSpace)
      .mockRejectedValueOnce(
        new ApiError({
          status: 503,
          code: "retrieval_unavailable",
          message: "down",
          details: {},
          requestId: "req-4",
        }),
      )
      .mockResolvedValueOnce({
        id: personalId,
        name: "个人空间",
        role: "OWNER",
        kind: "personal",
        version: 1,
        created_at: "2026-09-27T04:00:00Z",
        updated_at: "2026-09-27T04:00:00Z",
      });
    vi.mocked(getProject).mockResolvedValue({
      id: personalId,
      name: "个人空间",
      role: "OWNER",
      kind: "personal",
      version: 1,
      created_at: "2026-09-27T04:00:00Z",
      updated_at: "2026-09-27T04:00:00Z",
    });
    const user = userEvent.setup();
    renderAt("/studio");

    expect(
      await screen.findByRole("heading", { name: "无法打开个人空间" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByRole("heading", { name: "和 Lumi 一起开始创作" }),
    ).toBeInTheDocument();
    expect(ensurePersonalSpace).toHaveBeenCalledTimes(2);
  });

  it("opens the creative workspace without pretending chat is connected", async () => {
    vi.mocked(getProject).mockResolvedValue({
      id: projectId,
      name: "春季成片",
      role: "MEMBER",
      kind: "standard",
      version: 1,
      created_at: "2026-09-27T04:00:00Z",
      updated_at: "2026-09-27T04:00:00Z",
    });
    renderAt(`/projects/${projectId}`);

    expect(
      await screen.findByRole("heading", { name: "和 Lumi 一起开始创作" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "创作需求" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/当前文本模型/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "发送给模型" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "账户菜单" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).toBeNull();
    expect(screen.queryByText("演示")).not.toBeInTheDocument();
  });
  it("switches spaces from the account menu and keeps the current space on failure", async () => {
    const otherId = "22222222-2222-4222-8222-222222222222";
    const current = {
      id: projectId,
      name: "当前空间",
      role: "OWNER" as const,
      kind: "standard" as const,
      version: 1,
      created_at: "2026-09-27T04:00:00Z",
      updated_at: "2026-09-27T04:00:00Z",
    };
    const other = { ...current, id: otherId, name: "其他空间" };
    vi.mocked(getProject).mockImplementation(async (id) => {
      if (id === otherId) throw new Error("denied");
      return current;
    });
    vi.mocked(listProjects).mockResolvedValue({
      items: [current, other],
      next_cursor: null,
    });
    const user = userEvent.setup();
    renderAt(`/projects/${projectId}`);
    await user.click(await screen.findByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "切换空间" }));
    await user.click(await screen.findByRole("menuitem", { name: "其他空间" }));
    expect(await screen.findByText("切换空间失败，请重试")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "创作" })).toHaveAttribute(
      "href",
      `/projects/${projectId}`,
    );
    vi.mocked(getProject).mockImplementation(async (id) =>
      id === otherId ? other : current,
    );
    await user.click(screen.getByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "切换空间" }));
    await user.click(screen.getByRole("menuitem", { name: "其他空间" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "创作" })).toHaveAttribute(
        "href",
        `/projects/${otherId}`,
      ),
    );
    await user.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(localStorage.getItem("lumi.sidebar.collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    cleanup();
    renderAt(`/projects/${otherId}`);
    expect(
      await screen.findByRole("button", { name: "展开侧边栏" }),
    ).toHaveAttribute("aria-expanded", "false");

    expect(
      screen.getByRole("button", { name: "账户菜单" }),
    ).toBeInTheDocument();
  });
});
