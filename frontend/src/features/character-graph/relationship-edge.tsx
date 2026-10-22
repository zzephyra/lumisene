import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { useGraphActions } from "./graph-actions";

export type RelationshipFlowEdge = Edge<
  { lane: number; label: string; laneWidth?: number },
  "relationship"
>;

export function flowHandles(
  source: { x: number; y: number },
  target: { x: number; y: number },
) {
  const dx = target.x + 130 - (source.x + 130);
  const dy = target.y + 70 - (source.y + 70);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "out-right", targetHandle: "in-left" }
      : { sourceHandle: "out-left", targetHandle: "in-right" };
  }
  return dy >= 0
    ? { sourceHandle: "out-bottom", targetHandle: "in-top" }
    : { sourceHandle: "out-top", targetHandle: "in-bottom" };
}

// Group both directions together; ID ordering keeps lanes stable after refetches.
export function relationshipLanes(
  items: {
    id: string;
    source_character_id: string;
    target_character_id: string;
    relationship_type: string;
  }[],
) {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = JSON.stringify(
      [item.source_character_id, item.target_character_id].sort(),
    );
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const lanes = new Map<string, { lane: number; laneWidth: number }>();
  for (const peers of groups.values()) {
    peers.sort((a, b) => a.id.localeCompare(b.id));
    const laneWidth = Math.max(
      80,
      ...peers.map((item) =>
        Math.min(240, Array.from(item.relationship_type).length * 14 + 24),
      ),
    );
    peers.forEach((item, index) =>
      lanes.set(item.id, {
        lane:
          (index - (peers.length - 1) / 2) *
          (item.source_character_id < item.target_character_id ? 1 : -1),
        laneWidth,
      }),
    );
  }
  return lanes;
}

export function relationshipPath(
  props: Pick<
    EdgeProps<RelationshipFlowEdge>,
    | "sourceX"
    | "sourceY"
    | "targetX"
    | "targetY"
    | "sourcePosition"
    | "targetPosition"
    | "data"
  >,
): [string, number, number] {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const lane = props.data?.lane ?? 0;
  if (!lane) {
    const [path, x, y] = getBezierPath({ ...props, curvature: 0.22 });
    return [path, x, y];
  }
  const length = Math.max(1, Math.hypot(tx - sx, ty - sy));
  const nx = -(ty - sy) / length,
    ny = (tx - sx) / length;
  // Separate label rectangles along the normal, including long vertical-edge labels.
  const offset =
    lane *
    ((props.data?.laneWidth ?? 160) * Math.abs(nx) + 32 * Math.abs(ny) + 24);
  const reach = Math.max(40, Math.min(160, length * 0.35));
  const vector = (position: Position) =>
    position === Position.Left
      ? [-reach, 0]
      : position === Position.Right
        ? [reach, 0]
        : position === Position.Top
          ? [0, -reach]
          : [0, reach];
  const [ax, ay] = vector(props.sourcePosition),
    [bx, by] = vector(props.targetPosition);
  // Cubic midpoint receives 3/4 of the control-point displacement. Endpoints stay on handles.
  const cx = sx + ax + (nx * offset * 4) / 3,
    cy = sy + ay + (ny * offset * 4) / 3;
  const dx = tx + bx + (nx * offset * 4) / 3,
    dy = ty + by + (ny * offset * 4) / 3;
  return [
    `M ${sx},${sy} C ${cx},${cy} ${dx},${dy} ${tx},${ty}`,
    (sx + 3 * cx + 3 * dx + tx) / 8,
    (sy + 3 * cy + 3 * dy + ty) / 8,
  ];
}

export const RelationshipEdge = memo(function RelationshipEdge(
  props: EdgeProps<RelationshipFlowEdge>,
) {
  const actions = useGraphActions();
  const [path, labelX, labelY] = relationshipPath(props);
  return (
    <>
      <BaseEdge
        id={props.id}
        interactionWidth={18}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        path={path}
      />
      {props.data?.label && (
        <EdgeLabelRenderer>
          <button
            className={`relationship-label nodrag nopan${props.selected ? " selected" : ""}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              actions?.openRelationship(props.id);
            }}
          >
            {props.data.label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
