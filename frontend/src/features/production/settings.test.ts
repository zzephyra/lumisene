import { describe, expect, it } from "vitest";
import { resolveSettings } from "./api";

describe("制作设置", () => {
  it("缺少设置时使用默认画幅，不读取空对象", () => {
    expect(resolveSettings(undefined).aspect_ratio).toBe("9:16");
    expect(resolveSettings({}).resolution).toBe("1080");
  });

  it("保留任务里已经保存的画幅", () => {
    expect(resolveSettings({ aspect_ratio: "1:1" }).aspect_ratio).toBe("1:1");
  });
});
