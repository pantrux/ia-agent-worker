import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  isKnownTerminalToolResult,
  OPERATOR_DENIED_TOOL_CONTENT,
} from "../hitl-pending.js";
import {
  readChatWsReplyResetHandler,
  readChatWsTokenDeltaHandler,
} from "../chat-ws-stream.js";
import type { GraphState } from "../state.js";

/**
 * PAN-40: cuando `tools_node` emite un `ToolMessage` terminal (`Customer not found`,
 * denegación previa, error JSON conocido) **no se necesita** otra llamada al LLM Copilot
 * para reformatear: el reply es determinista y la latencia añadida del segundo `model_node`
 * (≈9 s observados en prod) no aporta valor al usuario. Este nodo construye el `AIMessage`
 * final localizado y emite los eventos WS (`reply_reset`, `reply_delta`) para mantener la
 * UX de streaming en `/demo`.
 */

/** Devuelve los `ToolMessage` correspondientes al último batch ejecutado por `tools_node`. */
function lastBatchToolMessages(state: GraphState): ToolMessage[] {
  const batchIds = (state.toolState as Record<string, unknown> | undefined)?.last_executed_batch;
  if (!Array.isArray(batchIds) || batchIds.length === 0) return [];
  const ids = new Set(batchIds.map((id) => String(id)));
  const out: ToolMessage[] = [];
  for (let i = state.messages.length - 1; i >= 0 && out.length < ids.size; i--) {
    const m = state.messages[i];
    if (m instanceof ToolMessage && m.tool_call_id && ids.has(m.tool_call_id)) {
      out.unshift(m);
    }
  }
  return out;
}

/**
 * `true` si todos los `ToolMessage` del último batch son terminales según
 * `isKnownTerminalToolResult`. El edge condicional `routeAfterTools` lo usa para enviar al
 * nodo `terminal_reply` y saltar el segundo round-trip al LLM.
 */
export function lastBatchIsAllTerminal(state: GraphState): boolean {
  const msgs = lastBatchToolMessages(state);
  if (msgs.length === 0) return false;
  return msgs.every((m) => isKnownTerminalToolResult(toContentString(m.content)));
}

function toContentString(content: unknown): string {
  if (typeof content === "string") return content;
  return String(content ?? "");
}

/**
 * Texto pre-formateado para un `ToolMessage` terminal. Mantiene paridad con lo que
 * normalmente diría el LLM ("No se pudo eliminar el cliente: <error>") para no
 * sorprender a usuarios que comparen contra historial previo.
 */
export function formatTerminalReply(toolMessage: ToolMessage): string {
  const content = toContentString(toolMessage.content);
  if (content === OPERATOR_DENIED_TOOL_CONTENT) {
    return "Operación cancelada por el operador.";
  }
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    if (parsed && typeof parsed.error === "string") {
      const err = parsed.error.trim();
      if (/customer not found/i.test(err)) {
        return "No se pudo eliminar el cliente: el cliente solicitado no existe en la base de datos.";
      }
      return `No se pudo completar la operación: ${err}.`;
    }
  } catch {
    /* contenido no JSON; reply genérico abajo */
  }
  return "No se pudo completar la operación solicitada.";
}

/** Nodo `terminal_reply`: produce el `AIMessage` final sin invocar al LLM. */
export function createTerminalReplyNode() {
  return async (state: GraphState, config?: RunnableConfig): Promise<Partial<GraphState>> => {
    const msgs = lastBatchToolMessages(state);
    const target = msgs[msgs.length - 1];
    const text = target ? formatTerminalReply(target) : "No se pudo completar la operación solicitada.";

    const onReplyReset = readChatWsReplyResetHandler(config);
    const onTokenDelta = readChatWsTokenDeltaHandler(config);
    if (onReplyReset) onReplyReset();
    if (onTokenDelta) await onTokenDelta(text);

    return {
      messages: [new AIMessage(text)],
      toolState: {
        ...state.toolState,
        terminal_reply: true,
      },
    };
  };
}
