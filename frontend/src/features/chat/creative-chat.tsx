import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowUp, Film, MessageSquarePlus, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useSession } from "../auth";
import { isApiError, userFacingMessage } from "../../lib/api";
import { createConversation, listConversations, listTurns, sendTurn } from "./api";
import "./creative-chat.css";
import { MessageTools } from "./message-tools";
import { ChatImage } from "./chat-image";

export function CreativeChat({ projectId, draft, onDraftChange, onGenerate, onActiveChange }: { onActiveChange?: (active: boolean) => void; projectId: string; draft: string; onDraftChange: (text: string) => void; onGenerate: (kind: "image" | "video", prompt: string) => void }) {
  const client = useQueryClient();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const id = params.get("conversation");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const expanded = !!id || sending;
  useEffect(() => { onActiveChange?.(expanded); }, [expanded, onActiveChange]);
  const lock = useRef(false);
  const attempt = useRef<{ conversation: string; request: string; prompt: string } | null>(null);
  const history = useInfiniteQuery({ queryKey: ["chat-conversations", session.data?.id, projectId], initialPageParam: 0, queryFn: ({ pageParam, signal }) => listConversations(projectId, pageParam, signal), getNextPageParam: (page, pages) => page.length === 50 ? pages.length * 50 : undefined });
  const turns = useInfiniteQuery({ queryKey: ["chat-turns", session.data?.id, projectId, id], initialPageParam: 0, enabled: !!id,
    queryFn: ({ pageParam, signal }) => listTurns(projectId, id!, pageParam, signal), getNextPageParam: (page, pages) => page.length === 50 ? pages.length * 50 : undefined,
    refetchInterval: query => query.state.data?.pages.flat().some(turn => turn.status === "queued" || turn.status === "running") ? 400 : false,
  });
  const items = [...(turns.data?.pages.flat() ?? [])].reverse();
  const active = items.some(turn => turn.status === "queued" || turn.status === "running");
  const last = items.at(-1);
  useEffect(() => {
    const node = messagesRef.current;
    if (node && followLatest.current) node.scrollTop = node.scrollHeight;
  }, [id, last?.id, last?.status, last?.reply]);
  function select(next: string | null) {
    if (lock.current) return;
    setError(""); attempt.current = null; followLatest.current = true;
    setParams(current => { const copy = new URLSearchParams(current); if (next) copy.set("conversation", next); else copy.delete("conversation"); return copy; });
  }
  async function send() {
    const prompt = draft.trim();
    if (!prompt || lock.current || active || (id && (turns.isPending || turns.isError))) return;
    followLatest.current = true; lock.current = true; setSending(true); setError("");
    const current = attempt.current?.prompt === prompt && (!id || attempt.current.conversation === id) ? attempt.current : { conversation: id ?? crypto.randomUUID(), request: crypto.randomUUID(), prompt };
    attempt.current = current;
    try {
      if (!id) await createConversation(projectId, current.conversation, prompt);
      await sendTurn(projectId, current.conversation, current.request, prompt);
      setParams(previous => { const next = new URLSearchParams(previous); next.set("conversation", current.conversation); return next; });
      onDraftChange(""); attempt.current = null;
      await Promise.all([client.invalidateQueries({ queryKey: ["chat-turns", session.data?.id, projectId, current.conversation] }), client.invalidateQueries({ queryKey: ["chat-conversations", session.data?.id, projectId] })]);
    } catch (reason) {
      setError(isApiError(reason) && reason.status === 422 ? "对话暂不可用，请在后台登记并指定文本生成模型，检查 DeepSeek 服务配置。" : isApiError(reason) && reason.status === 409 ? "已有回复正在生成，请刷新对话后继续。" : userFacingMessage(reason));
      if (id) void turns.refetch();
    } finally { lock.current = false; setSending(false); }
  }
  return <section className={`creative-chat${expanded ? " is-active" : ""}`} aria-label="创意对话">
    <div className="chat-history-bar"><Button variant="ghost" disabled={sending} onClick={() => select(null)}><MessageSquarePlus size={16} />新对话</Button><div className="chat-history-list">{history.data?.pages.flat().map(row => <Button variant="ghost" key={row.id} className={id === row.id ? "active" : ""} disabled={sending} onClick={() => select(row.id)} title={row.title}>{row.title}</Button>)}</div>{history.hasNextPage && <Button variant="ghost" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>更多对话</Button>}</div>
    {history.isError && <p role="alert">历史对话加载失败。<Button variant="ghost" onClick={() => void history.refetch()}>重试</Button></p>}
    {id && turns.isPending && <p role="status">正在加载对话…</p>}
    {id && turns.isError && <p role="alert">对话加载失败。<Button variant="ghost" onClick={() => void turns.refetch()}>重试</Button></p>}
    <div className="chat-messages" ref={messagesRef} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }} aria-live="polite">
      {turns.hasNextPage && <Button variant="ghost" disabled={turns.isFetchingNextPage} onClick={() => void turns.fetchNextPage()}>查看更早消息</Button>}
      {items.map(turn => <div className="chat-turn" key={turn.id}><div className="chat-user"><span>你</span><p>{turn.prompt}</p><MessageTools text={turn.prompt} /></div><div className="chat-assistant"><span><Sparkles size={15} />Lumi</span>
        {turn.status === "queued" || turn.status === "running" ? <p className="chat-streaming" role="status">{turn.reply || (turn.status === "queued" ? "等待回复…" : "正在思考…")}</p> : turn.status === "failed" ? <div role="alert">{turn.reply && <p>{turn.reply}</p>}<p>{turn.error_message || "回复失败，请重试"}</p><Button variant="outline" onClick={() => { attempt.current = null; onDraftChange(turn.prompt); }}>重新编辑并发送</Button></div> : <><p>{turn.reply}</p>{turn.reply && turn.proposal?.intent !== "image_generation" && <MessageTools text={turn.reply} />}</>}
        {turn.status === "succeeded" && turn.proposal?.generation_prompt && turn.proposal.intent === "image_generation" && <>
          <p className="chat-image-description">{turn.proposal.generation_prompt}</p>
          <ChatImage projectId={projectId} conversationId={id!} turnId={turn.id} taskId={turn.generation_task_id ?? null} text={`${turn.reply ?? ""}\n${turn.proposal.generation_prompt}`} submissionError={turn.error_message} />
        </>}
        {turn.status === "succeeded" && turn.proposal?.generation_prompt && turn.proposal.intent === "video_generation" && <div className="chat-proposal"><strong><Film size={17} />视频创作方案</strong><p>{turn.proposal.generation_prompt}</p><Button onClick={() => onGenerate("video", turn.proposal!.generation_prompt!)}>查看方案并设置生成</Button></div>}

      </div></div>)}
    </div>
    <div className="workspace-composer"><div className="composer-row"><label className="sr-only" htmlFor="creative-draft">创作需求</label><textarea id="creative-draft" placeholder="描述你的灵感，或告诉我想生成怎样的画面…" value={draft} maxLength={10000} onChange={event => onDraftChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /></div><div className="composer-bottom"><span className="composer-context">创意对话 · 自动保存</span><div><span className="draft-count">{draft.length.toLocaleString()} / 10,000</span><Button className="composer-submit" aria-label="发送消息" disabled={!draft.trim() || sending || active || (!!id && (turns.isPending || turns.isError))} onClick={() => void send()}><ArrowUp size={19} /></Button></div></div></div>
    {error && <p className="chat-error" role="alert">{error}</p>}
    <p className="chat-context-note" hidden={expanded}>发送后的对话保存到当前空间。模型最多参考最近 20 个成功回合，较早内容请重新说明。⌘ / Ctrl + Enter 发送</p>
  </section>;
}
