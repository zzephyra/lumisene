import type { components } from "../../api/schema";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
export type Conversation = components["schemas"]["ConversationResponse"];
export type Turn = components["schemas"]["TurnResponse"];
const base = (projectId: string) => `/api/v1/projects/${projectId}/conversations`;
function conversation(data: unknown): Conversation {
  if (!isRecord(data) || typeof data.id !== "string" || typeof data.title !== "string" || typeof data.created_at !== "string") throw new Error("Invalid conversation response");
  return { id: data.id, title: data.title, created_at: data.created_at };
}
function turn(data: unknown): Turn {
  if (!isRecord(data) || typeof data.id !== "string" || typeof data.prompt !== "string" || typeof data.created_at !== "string" || !["queued", "running", "succeeded", "failed", "canceled"].includes(String(data.status))) throw new Error("Invalid turn response");
  for (const key of ["reply", "error_code", "error_message"]) if (!(data[key] === null || typeof data[key] === "string")) throw new Error("Invalid turn text");
  if (!(data.generation_task_id === null || typeof data.generation_task_id === "string")) throw new Error("Invalid image task reference");
  const proposal = data.proposal;
  if (proposal !== null && (!isRecord(proposal) || typeof proposal.reply !== "string" || !["chat", "image_generation", "video_generation", "clarification"].includes(String(proposal.intent)) || !(proposal.generation_prompt === null || typeof proposal.generation_prompt === "string"))) throw new Error("Invalid intent proposal");
  return data as Turn;
}
export async function listConversations(projectId: string, offset: number, signal: AbortSignal): Promise<Conversation[]> {
  const data = await apiRequest({ path: `${base(projectId)}?offset=${offset}`, signal });
  if (!Array.isArray(data)) throw new Error("Invalid conversation list");
  return data.map(conversation);
}
export async function createConversation(projectId: string, id: string, title: string): Promise<Conversation> {
  return conversation(await apiRequest({ path: base(projectId), method: "POST", csrf: true, body: { id, title: title.slice(0, 120) } }));
}
export async function listTurns(projectId: string, id: string, offset: number, signal: AbortSignal): Promise<Turn[]> {
  const data = await apiRequest({ path: `${base(projectId)}/${id}/turns?offset=${offset}`, signal });
  if (!Array.isArray(data)) throw new Error("Invalid conversation turns");
  return data.map(turn);
}
export async function sendTurn(projectId: string, id: string, requestId: string, prompt: string): Promise<Turn> {
  return turn(await apiRequest({ path: `${base(projectId)}/${id}/turns`, method: "POST", csrf: true, body: { request_id: requestId, prompt } }));
}
