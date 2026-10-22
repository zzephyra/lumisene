import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphToolbar } from "./graph-toolbar";

function setup() {
  const props = {
    search: "",
    onSearch: vi.fn(),
    role: "",
    onRole: vi.fn(),
    relation: "",
    onRelation: vi.fn(),
    roles: ["主角"],
    relationTypes: ["朋友"],
    onFocus: vi.fn(),
    onLayout: vi.fn(),
    onFit: vi.fn(),
    onAdd: vi.fn(),
  };
  render(<GraphToolbar {...props} />);
  return props;
}
describe("graph toolbar", () => {
  it("opens search, forwards text and locates without relayout", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "搜索人物" }));
    const input = screen.getByRole("textbox", { name: "人物姓名" });
    fireEvent.change(input, { target: { value: "林" } });
    expect(props.onSearch).toHaveBeenCalledWith("林");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onFocus).toHaveBeenCalledOnce();
    expect(props.onLayout).not.toHaveBeenCalled();
  });
  it("keeps fitting independent of layout and exposes add", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "画布布局" }));
    await user.click(screen.getByRole("menuitem", { name: "适配视图" }));
    expect(props.onFit).toHaveBeenCalledOnce();
    expect(props.onLayout).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "添加人物" }));
    expect(props.onAdd).toHaveBeenCalledOnce();
  });
  it("preserves filter selection and provides reset", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "筛选" }));
    await user.click(screen.getByRole("menuitem", { name: "主角" }));
    expect(props.onRole).toHaveBeenCalledWith("主角");
    await user.click(screen.getByRole("menuitem", { name: "重置筛选" }));
    expect(props.onRole).toHaveBeenLastCalledWith("");
    expect(props.onRelation).toHaveBeenLastCalledWith("");
  });
});
