import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { CreativeChat } from "./creative-chat";
import { createConversation, listConversations, listTurns, sendTurn, type Turn } from "./api";
vi.mock("../auth", () => ({ useSession: () => ({ data: { id: "owner" } }) }));
vi.mock("./api", () => ({ createConversation: vi.fn(), listConversations: vi.fn(), listTurns: vi.fn(), sendTurn: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(listConversations).mockResolvedValue([]); vi.mocked(listTurns).mockResolvedValue([]); });
function setup(path = "/", onGenerate = vi.fn()) {
  function Harness() { const [draft, setDraft] = useState(""); return <CreativeChat projectId="p" draft={draft} onDraftChange={setDraft} onGenerate={onGenerate} />; }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter></QueryClientProvider>);
  return onGenerate;
}
const result: Turn = { generation_task_id: null, id: "turn", prompt: "画一只猫", status: "succeeded", reply: "请确认创作方案", proposal: { reply: "请确认创作方案", intent: "image_generation", generation_prompt: "一只白猫，水彩风格" }, error_code: null, error_message: null, created_at: "2026-10-14" };
it("creates and persists a turn instead of a draft preview", async () => {
  vi.mocked(createConversation).mockImplementation(async (_p, id, title) => ({ id, title, created_at: "2026-10-14" }));
  vi.mocked(sendTurn).mockResolvedValue(result);
  const callback = setup();
  await userEvent.type(screen.getByRole("textbox", { name: "创作需求" }), "画一只猫");
  await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(sendTurn).toHaveBeenCalledWith("p", expect.any(String), expect.any(String), "画一只猫"));
  expect(callback).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
});
it("offers inline generation without navigating away", async () => {
  vi.mocked(listTurns).mockResolvedValue([result]);
  const callback = setup("/?conversation=c");
  expect(await screen.findByText("一只白猫，水彩风格")).toBeInTheDocument();
  expect(callback).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "重新生成图片" })).toBeInTheDocument();
  expect(callback).not.toHaveBeenCalled();
});
it("does not show generation actions for discussion or negation", async () => {
  vi.mocked(listTurns).mockResolvedValue([{ ...result, proposal: { reply: "先讨论风格", intent: "chat", generation_prompt: null } }]);
  setup("/?conversation=c");
  await screen.findByText(result.prompt);
  expect(screen.queryByRole("button", { name: "查看方案并设置生成" })).not.toBeInTheDocument();
});

it("opens conversation mode for history and restores welcome mode for a new chat", async () => {
  vi.mocked(listTurns).mockResolvedValue([result]);
  setup("/?conversation=c");
  await screen.findByText(result.prompt);
  expect(screen.getByRole("region", { name: "创意对话" })).toHaveClass("is-active");
  expect(screen.getByText(/发送后的对话保存/)).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "新对话" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "创意对话" })).not.toHaveClass("is-active"));
  expect(screen.getByText(/发送后的对话保存/)).toBeVisible();
});
