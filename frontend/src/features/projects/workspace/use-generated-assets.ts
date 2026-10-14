import { useEffect, useState } from "react";
import { listImageGenerations } from "../image-generation";
import { userFacingMessage } from "../../../lib/api";
export type GeneratedAsset = { id: string; name: string; category: "image" | "video" };
export function useGeneratedAssets(projectId?: string) {
  const [state, setState] = useState<{ projectId?: string; items: GeneratedAsset[] }>({ items: [] });
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setError("");
    async function refresh() {
      try {
        const groups = await Promise.all((["image", "video"] as const).map(async kind => {
          const items: GeneratedAsset[] = [];
          for (let offset = 0; ; offset += 20) {
            const page = await listImageGenerations(projectId!, controller.signal, kind, offset);
            for (const task of page) if (task.status === "succeeded") for (const id of task.output_asset_ids) items.push({ id, name: task.prompt || (kind === "image" ? "生成图片" : "生成视频"), category: kind });
            if (page.length < 20) break;
          }
          return items;
        }));
        if (!controller.signal.aborted) { setState({ projectId, items: [...new Map(groups.flat().map(item => [item.id, item])).values()] }); setError(""); }
      } catch (reason) { if (!controller.signal.aborted) setError(userFacingMessage(reason)); }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => void refresh(), 15000); } }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, version]);
  return { items: state.projectId === projectId ? state.items : [], loading, error, refresh: () => setVersion(value => value + 1) };
}
