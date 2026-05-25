import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  isKnownTerminalToolResult,
  OPERATOR_DENIED_TOOL_CONTENT,
} from "../hitl-pending.js";
import { CRITICAL_TOOL_NAMES } from "../tools/crm.js";
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
 *
 * Restricciones de alcance (post-review Greptile/Devin/Gitar en PR #69):
 *
 * - **Solo tools críticas** (`CRITICAL_TOOL_NAMES`, hoy solo `delete_customer_record`).
 *   Para tools de lectura como `find_customer_by_name` o `getCustomerData` un resultado
 *   `{"error":"Customer not found"}` **no** es terminal: el LLM puede intentar otra tool,
 *   pedir información o elaborar la respuesta. Por eso `lastBatchIsAllTerminal` solo
 *   devuelve `true` si **todos** los tool calls del último batch son críticos.
 * - **Texto contextual al `tool_name`** del call original: para `delete_customer_record`
 *   se usa el copy específico de borrado; para futuros tools críticos cae a un texto
 *   genérico que no asume operación.
 * - **Múltiples mensajes terminales**: si el batch contiene varios (caso futuro con tools
 *   críticas en paralelo) se concatenan los replies únicos para no perder visibilidad de
 *   ningún error.
 */

interface ToolCallContext {
  name: string;
  args: Record<string, unknown>;
}

interface TerminalToolMatch {
  toolMessage: ToolMessage;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

function toContentString(content: unknown): string {
  if (typeof content === "string") return content;
  return String(content ?? "");
}

/**
 * Mapea `tool_call_id → {name, args}` recorriendo los `AIMessage` con `tool_calls` previos
 * en el estado. La búsqueda es necesaria porque `tools_node` solo registra los IDs del
 * batch en `state.toolState.last_executed_batch`, no los nombres ni los argumentos. Los
 * argumentos se utilizan para enriquecer el reply terminal (por ejemplo, mencionar el
 * `customer_id` afectado en una denegación HITL sin necesidad de pasar por el LLM).
 */
function buildToolCallContextIndex(state: GraphState): Map<string, ToolCallContext> {
  const index = new Map<string, ToolCallContext>();
  for (const m of state.messages) {
    if (m instanceof AIMessage && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        if (tc.id && !index.has(tc.id) && typeof tc.name === "string") {
          index.set(tc.id, {
            name: tc.name,
            args: (tc.args as Record<string, unknown>) ?? {},
          });
        }
      }
    }
  }
  return index;
}

/**
 * Devuelve los `ToolMessage` del último batch ejecutado por `tools_node` siempre que
 * **todos** sean (a) terminales según `isKnownTerminalToolResult` y (b) resultado de un
 * tool call cuyo `name` esté en `CRITICAL_TOOL_NAMES`. Si alguna de las dos condiciones
 * falla devuelve `null` y el grafo cae al loop normal `tools → model`.
 */
function lastBatchTerminalCriticalToolMessages(state: GraphState): TerminalToolMatch[] | null {
  const batchIds = (state.toolState as Record<string, unknown> | undefined)?.last_executed_batch;
  if (!Array.isArray(batchIds) || batchIds.length === 0) return null;
  const ids = new Set(batchIds.map((id) => String(id)));

  const ctxIndex = buildToolCallContextIndex(state);
  const matches: TerminalToolMatch[] = [];
  const seenIds = new Set<string>();
  for (let i = state.messages.length - 1; i >= 0 && matches.length < ids.size; i--) {
    const m = state.messages[i];
    if (!(m instanceof ToolMessage)) continue;
    const tid = m.tool_call_id;
    if (!tid || !ids.has(tid) || seenIds.has(tid)) continue;
    const ctx = ctxIndex.get(tid);
    const toolName = ctx?.name ?? "";
    if (!CRITICAL_TOOL_NAMES.has(toolName)) return null;
    if (!isKnownTerminalToolResult(toContentString(m.content))) return null;
    seenIds.add(tid);
    matches.unshift({ toolMessage: m, toolName, toolArgs: ctx?.args ?? {} });
  }
  // Hallazgo Gitar/Devin: solo consideramos el batch terminal si **todos** los IDs
  // declarados en `last_executed_batch` tienen un `ToolMessage` validado. Si falta
  // alguno (estado corrupto o futura ruta que descarte mensajes) caemos al loop
  // normal `tools → model` para no emitir un reply parcial.
  return matches.length === ids.size ? matches : null;
}

/**
 * `true` si todos los `ToolMessage` del último batch son terminales **y** corresponden a
 * tools críticas. El edge condicional `routeAfterTools` lo usa para enviar al nodo
 * `terminal_reply` y saltar el segundo round-trip al LLM.
 */
export function lastBatchIsAllTerminal(state: GraphState): boolean {
  return lastBatchTerminalCriticalToolMessages(state) !== null;
}

/**
 * Texto pre-formateado para un `ToolMessage` terminal. Mantiene paridad con lo que
 * normalmente diría el LLM ("No se pudo eliminar el cliente: <error>") cuando el tool
 * call es `delete_customer_record`; para futuros tools críticos cae a un texto genérico
 * que no asume la operación de borrado (evita el copy contradictorio que señalaron Devin
 * y Gitar para tools de lectura).
 *
 * Cuando se proporciona `toolArgs`, el reply se enriquece con datos del tool call (por
 * ejemplo, `customer_id`) para mantener la respuesta contextual sin necesidad de invocar
 * al LLM (compromiso documentado tras el `🚩` de Devin sobre denegación HITL).
 */
export function formatTerminalReply(
  toolMessage: ToolMessage,
  toolName?: string,
  toolArgs?: Record<string, unknown>
): string {
  const content = toContentString(toolMessage.content);
  if (content === OPERATOR_DENIED_TOOL_CONTENT) {
    if (toolName === "delete_customer_record") {
      const customerId = String(toolArgs?.customer_id ?? "").trim();
      if (customerId) {
        return `Operación cancelada por el operador. No se eliminó el cliente ${customerId}.`;
      }
    }
    return "Operación cancelada por el operador.";
  }
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    if (parsed && typeof parsed.error === "string") {
      const err = parsed.error.trim();
      if (toolName === "delete_customer_record" && /customer not found/i.test(err)) {
        const customerId = String(toolArgs?.customer_id ?? "").trim();
        if (customerId) {
          return `No se pudo eliminar el cliente ${customerId}: no existe en la base de datos.`;
        }
        return "No se pudo eliminar el cliente: el cliente solicitado no existe en la base de datos.";
      }
      return `No se pudo completar la operación: ${err}.`;
    }
  } catch {
    /* contenido no JSON; reply genérico abajo */
  }
  return "No se pudo completar la operación solicitada.";
}

/** Genera un único texto a partir de uno o varios matches terminales (deduplicado). */
function composeTerminalReply(matches: TerminalToolMatch[]): string {
  if (matches.length === 0) return "No se pudo completar la operación solicitada.";
  const replies = matches.map((m) => formatTerminalReply(m.toolMessage, m.toolName, m.toolArgs));
  const unique: string[] = [];
  for (const r of replies) {
    if (!unique.includes(r)) unique.push(r);
  }
  if (unique.length === 1) return unique[0];
  return unique.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

/** Nodo `terminal_reply`: produce el `AIMessage` final sin invocar al LLM. */
export function createTerminalReplyNode() {
  return async (state: GraphState, config?: RunnableConfig): Promise<Partial<GraphState>> => {
    const matches = lastBatchTerminalCriticalToolMessages(state) ?? [];
    const text = composeTerminalReply(matches);

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
