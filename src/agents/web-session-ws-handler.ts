import type { Env } from "../env.js";
import { extractLastAiReply } from "../chat-reply.js";
import { classifyChatGraphError } from "../chat-graph-error.js";
import {
  isGraphInterruptError,
  runChatMessageGraph,
  runChatResumeGraph,
} from "../chat-invocation.js";
import { parseThreadId } from "../chat-queue-payload.js";
import type { WsClientMessage, WsServerMessage } from "../ws-protocol.js";
import {
  applyWsMessageRateLimit,
  WS_MESSAGE_RATE_MAX,
  type WsMessageRateLimitFields,
} from "../ws-message-rate-limit.js";
import { wsStreamPauseMs } from "../ws-stream-pace.js";

export interface WebSessionAgentState extends WsMessageRateLimitFields {
  threadId: string;
  userId: string;
}

export type WebSessionWsHandlerDeps = {
  env: Env;
  state: WebSessionAgentState;
  sessionId: string;
  send: (msg: WsServerMessage) => void;
  setState: (state: WebSessionAgentState) => void;
};

function ensureThreadId(
  deps: WebSessionWsHandlerDeps,
  extraPatch: Partial<WebSessionAgentState> = {}
): string {
  const existing = parseThreadId(deps.state.threadId);
  if (existing) return existing;
  const threadId = crypto.randomUUID();
  deps.setState({ ...deps.state, ...extraPatch, threadId });
  return threadId;
}

/**
 * Despacha mensajes WS del cliente (chat / resume / ping) hacia el grafo LangGraph.
 * Extraído de `WebSessionAgent` para pruebas de integración (PAN-32).
 */
export async function dispatchWebSessionWsMessage(
  deps: WebSessionWsHandlerDeps,
  parsed: WsClientMessage
): Promise<void> {
  if (parsed.type === "ping") {
    deps.send({ type: "pong" });
    return;
  }

  const rateLimit = applyWsMessageRateLimit(deps.state);
  deps.setState({ ...deps.state, ...rateLimit.statePatch });
  if (!rateLimit.allowed) {
    deps.send({
      type: "error",
      code: "rate_limited",
      message: `Demasiados mensajes en esta sesión. Máximo ${WS_MESSAGE_RATE_MAX} por minuto.`,
    });
    return;
  }

  const channel = "web";
  const userId = deps.state.userId || "anonymous";
  const sessionId = deps.sessionId;

  if (parsed.type === "resume") {
    const threadId = parseThreadId(deps.state.threadId);
    if (!threadId) {
      deps.send({
        type: "error",
        code: "no_thread",
        message: "No hay hilo activo para reanudar",
      });
      return;
    }
    try {
      const result = await runChatResumeGraph(deps.env, {
        threadId,
        channel,
        userId,
        approved: parsed.approved,
        operation: "ws_resume",
        sessionId,
      });
      const reply = extractLastAiReply(result);
      deps.send({
        type: "reply",
        text: reply,
        thread_id: threadId,
        industry: result.industry,
        intent: result.intent,
        tool_state: result.toolState,
      });
    } catch (e: unknown) {
      if (isGraphInterruptError(e)) {
        const err = e as { value?: unknown };
        deps.send({
          type: "hitl_pending",
          thread_id: threadId,
          interrupt: err.value ?? null,
        });
        return;
      }
      console.error("[WebSessionAgent] resume error:", e);
      const classified = classifyChatGraphError(e, "resume");
      deps.send({
        type: "error",
        code: classified.code,
        message: classified.message,
      });
    }
    return;
  }

  const threadId = ensureThreadId(deps, rateLimit.statePatch);
  try {
    const result = await runChatMessageGraph(deps.env, {
      text: parsed.text,
      threadId,
      channel,
      userId,
      operation: "ws_chat",
      sessionId,
      onReplyReset: () => {
        deps.send({ type: "reply_reset", thread_id: threadId });
      },
      onTokenDelta: async (delta) => {
        if (!delta) return;
        deps.send({ type: "reply_delta", delta, thread_id: threadId });
        await wsStreamPauseMs();
      },
    });
    const reply = extractLastAiReply(result);
    deps.send({
      type: "reply",
      text: reply,
      thread_id: threadId,
      industry: result.industry,
      intent: result.intent,
      tool_state: result.toolState,
    });
  } catch (e: unknown) {
    if (isGraphInterruptError(e)) {
      const err = e as { value?: unknown };
      deps.send({
        type: "hitl_pending",
        thread_id: threadId,
        interrupt: err.value ?? null,
      });
      return;
    }
    console.error("[WebSessionAgent] chat error:", e);
    const classified = classifyChatGraphError(e, "chat");
    deps.send({
      type: "error",
      code: classified.code,
      message: classified.message,
    });
  }
}
