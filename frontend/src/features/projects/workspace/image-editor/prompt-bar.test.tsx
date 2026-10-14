import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { PromptBar } from "./prompt-bar";

it("uses the same reason for enter and click", async () => {
  const onSubmit = vi.fn();
  const view = render(
    <PromptBar busy hasSelection modelBlocked={false} onChange={vi.fn()} onSubmit={onSubmit} value="补上小路" />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("正在准备图片。");
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(onSubmit).not.toHaveBeenCalled();

  view.rerender(
    <PromptBar busy={false} hasSelection modelBlocked onChange={vi.fn()} onSubmit={onSubmit} value="补上小路" />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("当前模型不支持图片编辑。");

  view.rerender(
    <PromptBar busy={false} hasSelection={false} modelBlocked={false} onChange={vi.fn()} onSubmit={onSubmit} value="补上小路" />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("请先框选需要修改的区域。");
  expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();

  view.rerender(
    <PromptBar busy={false} hasSelection modelBlocked={false} onChange={vi.fn()} onSubmit={onSubmit} value="  " />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("请输入修改要求。");
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(onSubmit).not.toHaveBeenCalled();

  view.rerender(
    <PromptBar busy={false} hasSelection modelBlocked={false} onChange={vi.fn()} onSubmit={onSubmit} value="补上小路" />,
  );
  await userEvent.click(screen.getByRole("button", { name: "生成" }));
  expect(onSubmit).toHaveBeenCalledOnce();
});
