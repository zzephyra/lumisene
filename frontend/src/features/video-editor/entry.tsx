import { useQuery } from "@tanstack/react-query";
import { Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { editorError } from "./api";
import { createDocument, listDocuments, mediaUrl } from "./api";
import { inspectMedia } from "./media";
export function EditVideoButton({
  projectId,
  assetId,
}: {
  projectId: string;
  assetId: string;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function open() {
    if (pending) return;
    setPending(true);
    setError(null);
    controller.current = new AbortController();
    try {
      const media = await inspectMedia(
        mediaUrl(projectId, assetId),
        controller.current.signal,
      );
      const ratio = Math.min(1, 1920 / Math.max(media.width, media.height));
      const width = Math.max(240, Math.floor((media.width * ratio) / 2) * 2);
      const height = Math.max(240, Math.floor((media.height * ratio) / 2) * 2);
      const doc = await createDocument(projectId, {
        title: "我的视频剪辑",
        composition: {
          schema_version: 1,
          fps: 30,
          frame: "fit",
          width,
          height,
          duration_in_frames: media.frames,
          tracks: [
            {
              id: "video",
              type: "video",
              clips: [
                {
                  id: crypto.randomUUID(),
                  asset_id: assetId,
                  source_start_frame: 0,
                  source_end_frame: media.frames,
                  original_duration: media.frames,
                  timeline_start_frame: 0,
                  duration: media.frames,
                  volume: 1,
                  muted: false,
                  speed: 1,
                },
              ],
            },
          ],
        },
      });
      if (!controller.current.signal.aborted)
        navigate(`/projects/${projectId}/editor/${doc.id}`);
    } catch (e) {
      if (!controller.current?.signal.aborted) setError(editorError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <Button disabled={pending} onClick={() => void open()}>
        <Scissors size={15} /> {pending ? "正在打开…" : "编辑视频"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function RecentEdits({ projectId }: { projectId: string }) {
  const docs = useQuery({
    queryKey: ["projects", projectId, "editor-documents"],
    queryFn: ({ signal }) => listDocuments(projectId, signal),
  });
  return (
    <details className="ve-recent">
      <summary>已保存的剪辑工程</summary>
      {docs.isPending ? (
        <p>正在加载…</p>
      ) : docs.isError ? (
        <Button variant="ghost" onClick={() => void docs.refetch()}>
          加载失败，重试
        </Button>
      ) : docs.data.items.length === 0 ? (
        <p>编辑视频后可在此继续剪辑</p>
      ) : (
        docs.data.items.map((doc) => (
          <Link key={doc.id} to={`/projects/${projectId}/editor/${doc.id}`}>
            {doc.title}
          </Link>
        ))
      )}
    </details>
  );
}
