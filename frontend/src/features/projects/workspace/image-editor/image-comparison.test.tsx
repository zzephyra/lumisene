import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ImageComparison } from "./image-comparison";

it("reveals original and result across the complete slider range", () => {
  render(<ImageComparison original="/before.png" result="/after.png" />);
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(screen.getByAltText("重绘前原图")).toHaveStyle({ clipPath: "inset(0 100% 0 0)" });
  fireEvent.change(slider, { target: { value: "100" } });
  expect(screen.getByAltText("重绘前原图")).toHaveStyle({ clipPath: "inset(0 0% 0 0)" });
  expect(screen.getByAltText("重绘结果")).toHaveAttribute("src", "/after.png");
});
