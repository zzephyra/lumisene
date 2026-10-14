import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorksPanel } from "./works-panel";
import { listImageGenerations } from "../image-generation";
vi.mock("../image-generation", () => ({ listImageGenerations: vi.fn(), assetContentPath: (_: string, id: string) => `/assets/${id}` }));
it("loads older pages and selects without navigating", async () => {
  const page = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, status: "succeeded", output_asset_ids: [`a${i}`] }));
  vi.mocked(listImageGenerations).mockResolvedValueOnce(page as never).mockResolvedValueOnce([{ id: "old", status: "succeeded", output_asset_ids: ["older"] }] as never);
  const onSelect = vi.fn();
  render(<WorksPanel projectId="p" kind="image" history={[]} onSelect={onSelect} onDelete={vi.fn()} />);
  await userEvent.click(screen.getByLabelText("展开项目作品"));
  await waitFor(() => expect(screen.getAllByLabelText("选中作品")).toHaveLength(21));
  expect(listImageGenerations).toHaveBeenLastCalledWith("p", expect.any(AbortSignal), "image", 20);
  await userEvent.click(screen.getAllByLabelText("选中作品")[20]);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getAllByLabelText("选中作品")[20]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("项目作品面板")).toHaveAttribute("aria-hidden", "false");
});
