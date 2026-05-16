import type { ChatGraphInvokeResult } from "./chat-invocation.js";

/** Último mensaje del estado del grafo (mismo criterio que HTTP `/api/chat`). */
export function extractLastAiReply(result: ChatGraphInvokeResult): string {
  const messages = result.messages ?? [];
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return "";
  return typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content);
}
