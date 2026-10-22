import { isRecord } from "../../lib/record";
import type { Production } from "./api";
/** Snapshot content is versioned separately from live story content. */
export function sourceChapters(data: Production) {
  const raw = data.snapshot.chapters;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((c) => ({
    id: String(c.id),
    title: String(c.title ?? ""),
    summary: String(c.summary ?? ""),
    scenes: (Array.isArray(c.scenes) ? c.scenes : [])
      .filter(isRecord)
      .map((s) => ({
        id: String(s.id),
        title: String(s.title ?? ""),
        content: (Array.isArray(s.blocks) ? s.blocks : [])
          .filter(isRecord)
          .map((b) => String(b.content ?? ""))
          .join("\n\n"),
      })),
  }));
}
export function SourcePanel({ data }: { data: Production }) {
  return (
    <div className="production-source-tree">
      <h2>剧本快照</h2>
      <p className="text-muted">
        以下为本次制作选定的原文。原剧本更新不会自动替换。
      </p>
      {sourceChapters(data).map((chapter) => (
        <details key={chapter.id} open>
          <summary>{chapter.title}</summary>
          <p>{chapter.summary}</p>
          {chapter.scenes.map((scene) => (
            <details key={scene.id}>
              <summary>{scene.title}</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {scene.content || "暂无原文内容"}
              </p>
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}
