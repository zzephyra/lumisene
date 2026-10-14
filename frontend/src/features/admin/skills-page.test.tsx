import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { SkillsScreen } from "./skills-page";
import { listSkills, saveSkill, operateSkill, type Skill } from "./skills-api";
vi.mock("../auth", () => ({ useSession: () => ({ data: { id: "admin" } }) }));
vi.mock("./skills-api", () => ({
  listSkills: vi.fn(),
  saveSkill: vi.fn(),
  operateSkill: vi.fn(),
}));
const row: Skill = {
  id: "skill",
  slug: "storyboard",
  name: "电影分镜",
  description: "分镜说明",
  content: "<script>alert(1)</script>",
  enabled: false,
  version: 1,
  created_at: "2026-10-07T00:00:00Z",
  updated_at: "2026-10-07T00:00:00Z",
};
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>
        <SkillsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSkills).mockResolvedValue({ items: [row], total: 1 });
  vi.mocked(saveSkill).mockResolvedValue(row);
  vi.mocked(operateSkill).mockResolvedValue(undefined);
});
it("creates a creative skill and closes after persistence", async () => {
  mount();
  await userEvent.click(screen.getByRole("button", { name: "新增技能" }));
  await userEvent.type(screen.getByLabelText("名称"), "镜头设计");
  await userEvent.type(screen.getByLabelText("唯一标识"), "camera-design");
  await userEvent.type(
    screen.getByLabelText("技能正文 · Markdown"),
    "Create a cinematic shot",
  );
  await userEvent.click(screen.getByRole("button", { name: "保存技能" }));
  await waitFor(() =>
    expect(saveSkill).toHaveBeenCalledWith(
      {
        name: "镜头设计",
        slug: "camera-design",
        description: "",
        content: "Create a cinematic shot",
      },
      undefined,
    ),
  );
  expect(await screen.findByText("技能已保存")).toBeInTheDocument();
});
it("requires confirmation for activation and deletion", async () => {
  mount();
  await screen.findByText("电影分镜");
  await userEvent.click(screen.getByRole("button", { name: "激活" }));
  expect(operateSkill).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认操作" }));
  await waitFor(() => expect(operateSkill).toHaveBeenCalledWith(row, "toggle"));
  await screen.findByText("技能状态已更新");
  await userEvent.click(screen.getByRole("button", { name: "删除 电影分镜" }));
  await userEvent.click(screen.getByRole("button", { name: "确认操作" }));
  await waitFor(() => expect(operateSkill).toHaveBeenCalledWith(row, "delete"));
});
it("shows stored markup as inert text", async () => {
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "电影分镜" }),
  );
  expect(screen.getByLabelText("技能正文 · Markdown")).toHaveValue(row.content);
  expect(document.querySelector("script")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "保存技能" }),
  ).not.toBeInTheDocument();
});
it("does not allow new bindings to retired outpainting", async () => {
  mount();
  await userEvent.click(screen.getByRole("button", { name: "新增技能" }));
  expect(screen.getByRole("option", { name: "旧扩图绑定（已停用）" })).toBeDisabled();
});
