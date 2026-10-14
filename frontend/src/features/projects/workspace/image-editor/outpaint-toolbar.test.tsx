import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { useOutpaint } from "./hooks/use-outpaint";
import { OutpaintToolbar } from "./outpaint-toolbar";

it("lets the user describe content for Wan expand", () => {
  const setPrompt = vi.fn();
  const state = {
    available: true,
    error: null,
    extension: { top: 0, right: 0, bottom: 0, left: 0 },
    frame: { width: 1024, height: 1024, imageX: 0, imageY: 0 },
    generate: vi.fn(),
    hint: "",
    loadingOptions: false,
    pending: false,
    percent: 20,
    phase: "",
    prompt: "森林",
    quick: vi.fn(),
    ratio: null,
    reason: null,
    reset: vi.fn(),
    setFrame: vi.fn(),
    setPercent: vi.fn(),
    setPrompt,
    chooseRatio: vi.fn(),
  } as unknown as ReturnType<typeof useOutpaint>;

  render(<OutpaintToolbar onCancel={vi.fn()} state={state} />);
  const input = screen.getByRole("textbox", { name: "扩图描述" });
  expect(input).toHaveAttribute("maxlength", "800");
  fireEvent.change(input, { target: { value: "一位绿色仙子" } });
  expect(setPrompt).toHaveBeenCalledWith("一位绿色仙子");
});
