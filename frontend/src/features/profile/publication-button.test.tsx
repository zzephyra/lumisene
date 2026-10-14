import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PublicationButton } from "./publication-button";
import { setPublication } from "./works-api";
vi.mock("./works-api", () => ({ setPublication: vi.fn() }));
it("requires explicit confirmation and persists publication", async () => {
  vi.mocked(setPublication).mockResolvedValue({ id: "a", public: true, can_publish: true });
  render(<QueryClientProvider client={new QueryClient()}><PublicationButton projectId="p" publication={{ id: "a", public: false, can_publish: true }} /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "私密 · 公开" }));
  expect(setPublication).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认公开" }));
  await waitFor(() => expect(setPublication).toHaveBeenCalledWith("p", "a", true));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});
