import { useState } from "react";
import { reviewShots } from "./shot-review";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { duplicateShot, mergeShots, Storyboard } from "./board-editor";
import { newShot, type Board } from "./api";
function fixture(): Board {
  return {
    adaptation_summary: "",
    visual_style: "",
    scenes: [
      {
        description: "",
        setting: "",
        time_of_day: "",
        id: "scene",
        title: "雨夜",
        shots: [
          {
            ...newShot(),
            id: "a",
            description: "推门",
            duration: 5,
            confirmed: true,
            selected_video_id: "version",
          },
          { ...newShot(), id: "b", description: "转身", duration: 7 },
        ],
      },
    ],
  };
}
describe("分镜编辑", () => {
  it("复制使用新ID并清除生成版本，原镜头保持不变", () => {
    const original = fixture(),
      next = duplicateShot(original, "a");
    expect(next.scenes![0].shots).toHaveLength(3);
    expect(next.scenes![0].shots![1]).toMatchObject({
      confirmed: false,
      selected_video_id: null,
    });
    expect(next.scenes![0].shots![1].id).not.toBe("a");
    expect(original.scenes![0].shots![0].selected_video_id).toBe("version");
  });
  it("拆分保留总时长且要求重新确认", () => {
    const next = duplicateShot(fixture(), "a", true).scenes![0].shots!;
    expect(next[0].duration + next[1].duration).toBe(5);
    expect(next[0].confirmed).toBe(false);
  });
  it("合并相邻镜头保留对白并清除已采用结果", () => {
    const original = fixture(),
      next = mergeShots(original, "a").scenes![0].shots!;
    expect(next).toHaveLength(1);
    expect(next[0].duration).toBe(12);
    expect(next[0].selected_video_id).toBeNull();
    expect(original.scenes![0].shots).toHaveLength(2);
  });
  it("不合并不同原文来源的镜头", () => {
    const original = fixture();
    original.scenes![0].shots![1].source_chapter_id = "other";
    expect(mergeShots(original, "a")).toBe(original);
  });
  it("卡片选择只选择当前镜头，切换列表不修改分镜", () => {
    const select = vi.fn(),
      edit = vi.fn();
    render(
      <Storyboard
        projectId="p"
        board={fixture()}
        onSelect={select}
        onEdit={edit}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1. 推门/ }));
    expect(select).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "列表" }));
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("计划操作与质量提醒", () => {
  it("移除已生成镜头保留场景，支持撤销恢复引用", () => {
    function Editor() {
      const [board, setBoard] = useState(fixture());
      return (
        <Storyboard
          projectId="p"
          board={board}
          onEdit={setBoard}
          onSelect={vi.fn()}
          disabled={false}
        />
      );
    }
    render(<Editor />);
    fireEvent.click(screen.getAllByLabelText("镜头更多操作")[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "删除镜头" })[0]);
    expect(
      screen.queryByRole("button", { name: /1. 推门/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/雨夜/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: /1. 推门/ })).toHaveTextContent(
      "已采用视频",
    );
  });
  it("同一场景不同动作不判重复，保留意图持久化", () => {
    const board = fixture();
    expect(reviewShots(board)).toHaveLength(0);
    board.scenes![0].shots![1] = { ...board.scenes![0].shots![0], id: "b" };
    const [review] = reviewShots(board);
    expect(review).toBeDefined();
    expect(
      reviewShots({ ...board, dismissed_reviews: [review.key] }),
    ).toHaveLength(0);
    board.scenes![0].shots![1].action = "跑出房间";
    expect(reviewShots(board)).toHaveLength(0);
  });
});
