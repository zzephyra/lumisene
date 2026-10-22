import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import { relationshipLanes, relationshipPath } from "./relationship-edge";

describe("parallel relationships", () => {
  const items = [
    {
      id: "1",
      source_character_id: "a",
      target_character_id: "b",
      relationship_type: "阻碍/隐瞒真相",
    },
    {
      id: "2",
      source_character_id: "b",
      target_character_id: "a",
      relationship_type: "朋友",
    },
    {
      id: "3",
      source_character_id: "a",
      target_character_id: "b",
      relationship_type: "同事",
    },
  ];
  it("assigns stable lanes regardless of response order", () => {
    expect(relationshipLanes(items)).toEqual(
      relationshipLanes([...items].reverse()),
    );
  });
  for (const horizontal of [true, false])
    it(`separates reverse edges and keeps endpoints attached (${horizontal})`, () => {
      const lanes = relationshipLanes(items);
      const labels = items
        .map((item) => {
          const reverse = item.source_character_id === "b";
          const start = reverse ? 400 : 0,
            end = reverse ? 0 : 400;
          const [path, x, y] = relationshipPath({
            sourceX: horizontal ? start : 0,
            sourceY: horizontal ? 0 : start,
            targetX: horizontal ? end : 0,
            targetY: horizontal ? 0 : end,
            sourcePosition: horizontal
              ? reverse
                ? Position.Left
                : Position.Right
              : reverse
                ? Position.Top
                : Position.Bottom,
            targetPosition: horizontal
              ? reverse
                ? Position.Right
                : Position.Left
              : reverse
                ? Position.Bottom
                : Position.Top,
            data: { label: item.relationship_type, ...lanes.get(item.id)! },
          });
          expect(path).toMatch(
            new RegExp(
              `^M\\s*${horizontal ? start : 0}[ ,]${horizontal ? 0 : start}`,
            ),
          );
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          return horizontal ? y : x;
        })
        .sort((a, b) => a - b);
      expect(labels[1] - labels[0]).toBeGreaterThan(horizontal ? 32 : 110);
      expect(labels[2] - labels[1]).toBeGreaterThan(horizontal ? 32 : 110);
    });
});
