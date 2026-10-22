import type { Board, Shot } from "./api";
const normalize = (s = "") => s.replace(/\s/g, "").toLowerCase();
export function similarShots(a: Shot, b: Shot) {
  if (!a.description || !b.description) return false;
  return (
    normalize(a.description) === normalize(b.description) &&
    normalize(a.action) === normalize(b.action) &&
    normalize(a.emotion) === normalize(b.emotion) &&
    a.narrative_role === b.narrative_role &&
    a.framing === b.framing &&
    a.angle === b.angle &&
    a.movement === b.movement
  );
}
export function reviewShots(board: Board) {
  const shots = board.scenes?.flatMap((s) => s.shots ?? []) ?? [];
  return shots
    .flatMap((a, i) =>
      shots.slice(i + 1).flatMap((b, offset) => {
        if (!similarShots(a, b)) return [];
        const value = JSON.stringify([
          a.id,
          b.id,
          a.description,
          a.action,
          a.emotion,
          a.framing,
          a.angle,
          a.movement,
        ]);
        let hash = 2166136261;
        for (const char of value)
          hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        const key = String(hash >>> 0);
        if (board.dismissed_reviews?.includes(key)) return [];
        return [
          {
            key,
            first: a,
            second: b,
            firstNumber: i + 1,
            secondNumber: i + offset + 2,
          },
        ];
      }),
    )
    .slice(0, 12);
}
