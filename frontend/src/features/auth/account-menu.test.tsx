import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMe } from "./api";
import { AccountMenu } from "./account-menu";

vi.mock("./api", () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
  sessionQueryKey: ["auth", "session"],
}));

const projectId = "11111111-1111-4111-8111-111111111111";

function renderMenu() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projects/${projectId}/generation`]}>
        <AccountMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AccountMenu", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockReset();
  });

  it("shows only the avatar until opened", async () => {
    vi.mocked(getMe).mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      platform_admin: true,
    });
    const user = userEvent.setup();
    renderMenu();

    const menu = await screen.findByRole("button", { name: "账户菜单" });
    expect(menu).toHaveTextContent("O");
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    await user.click(menu);
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /个人主页/ })).toHaveAttribute(
      "href",
      `/projects/${projectId}/profile`,
    );
    expect(screen.getByRole("menuitem", { name: "模型目录" })).toHaveAttribute("href", "/admin/models");
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
  });
});

it("普通用户的账户菜单不显示管理员入口", async () => {
  vi.mocked(getMe).mockResolvedValue({ id: "member", email: "member@example.com", platform_admin: false });
  const user = userEvent.setup();
  renderMenu();
  await user.click(await screen.findByRole("button", { name: "账户菜单" }));
  expect(screen.queryByRole("menuitem", { name: "模型目录" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
});
