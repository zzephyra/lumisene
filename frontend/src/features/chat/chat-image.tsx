import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { assetContentPath, getImageGeneration } from "../projects/image-generation";
import { userFacingMessage } from "../../lib/api";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
import { GenerationLoadingCard } from "../../components/generation-loading";
import { MessageTools } from "./message-tools";

export function ChatImage({ projectId, conversationId, turnId, taskId, text, submissionError }: { projectId: string; conversationId: string; turnId: string; taskId: string | null; text?: string; submissionError?: string | null }) {
  const client = useQueryClient();
  const [localId, setLocalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const id = localId ?? taskId;
  const task = useQuery({ queryKey: ["chat-image", projectId, id], enabled: !!id,
    queryFn: ({ signal }) => getImageGeneration(projectId, id!, signal),
    refetchInterval: query => query.state.data && ["queued", "running"].includes(query.state.data.status) ? 1500 : false,
  });
  async function generate() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const data = await apiRequest({ path: `/api/v1/projects/${projectId}/conversations/${conversationId}/turns/${turnId}/image`, method: "POST", csrf: true });
      if (!isRecord(data) || typeof data.generation_task_id !== "string") throw new Error("生成任务响应异常");
      setLocalId(data.generation_task_id);
      void client.invalidateQueries({ queryKey: ["chat-turns"] });
    } catch (reason) { setError(userFacingMessage(reason)); }
    finally { setBusy(false); lock.current = false; }
  }
  return <div className="chat-image-result">
    {!id && !busy && <div role="status"><p>{submissionError || "此历史方案尚未生成图片"}</p><Button onClick={() => void generate()}>重新生成图片</Button></div>}
    {error && <p role="alert">{error}</p>}
    {(busy || (id && (task.isPending || ["queued", "running"].includes(task.data?.status ?? "")))) && <div className="chat-image-stage"><GenerationLoadingCard status="generating" /></div>}
    {task.isError && <p role="alert">无法读取生成状态。<Button onClick={() => void task.refetch()}>重新加载</Button></p>}
    {task.data?.status === "failed" && <p role="alert">{task.data.error?.message ?? "图片生成失败，请重试。"}<Button disabled={busy} onClick={() => void generate()}>重新生成图片</Button></p>}
    {task.data?.status === "canceled" && <p>图片生成已取消。</p>}
    {task.data?.status === "succeeded" && task.data.output_asset_ids.map(assetId => <div className="chat-image-message" key={assetId}><div className="chat-image-stage">
      <img src={assetContentPath(projectId, assetId)} alt="对话生成的图片" loading="lazy" /></div>
      <MessageTools text={text} imageUrl={assetContentPath(projectId, assetId)} editUrl={`/projects/${projectId}/generation?editAsset=${encodeURIComponent(assetId)}`} />
    </div>)}
    {task.data?.status !== "succeeded" && text && <MessageTools text={text} />}
  </div>;
}
