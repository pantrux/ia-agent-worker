import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { Env } from "./env.js";
import { CRITICAL_TOOL_NAMES, createCrmTools } from "./tools/crm.js";

export const SYNTHETIC_HITL_PENDING_KEY = "synthetic_hitl_pending";

export const OPERATOR_DENIED_TOOL_CONTENT = "Operator denied this CRM mutation.";

export type HitlApprovalPayload = {
  kind: "tool_approval";
  tool: string;
  args: Record<string, unknown>;
  tool_call_id: string;
  synthetic?: boolean;
};

/** Nombres del seed demo para HITL sin `cust-XXX` en el mensaje. */
const DEMO_NAME_HINTS: Record<string, string> = {
  "acme retail": "cust-001",
  acme: "cust-001",
  "finance co": "cust-002",
  "clinic plus": "cust-003",
};

function sameToolArgs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * PAN-39: dado un historial, busca el `ToolMessage` resultado de la última invocación previa
 * de `toolName` con los mismos `args`. Devuelve el `content` del `ToolMessage` (string) o
 * `undefined` si no hay coincidencia. Sirve para reusar resultados terminales (errores conocidos
 * o denegación previa) y evitar pedir nueva aprobación HITL para una acción ya resuelta.
 */
export function findPreviousToolResultForCall(
  messages: readonly BaseMessage[],
  toolName: string,
  args: Record<string, unknown>
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue;
    for (const tc of m.tool_calls) {
      if (tc.name !== toolName) continue;
      if (!sameToolArgs((tc.args as Record<string, unknown>) ?? {}, args)) continue;
      const tid = tc.id;
      if (!tid) continue;
      for (let j = i + 1; j < messages.length; j++) {
        const t = messages[j];
        if (t instanceof ToolMessage && t.tool_call_id === tid) {
          return String(t.content);
        }
      }
    }
  }
  return undefined;
}

/**
 * PAN-39: clasifica el `content` de un `ToolMessage` previo como "terminal" — es decir, un
 * resultado que el agente puede reusar sin volver a interrumpir al operador (por ejemplo
 * `Customer not found`, `Order not found` o la denegación explícita del operador).
 *
 * Heurística conservadora: solo se considera terminal cuando hay denegación textual o cuando
 * el JSON contiene una clave `error` de tipo string. Errores transitorios sin esa forma
 * (timeouts, excepciones envueltas con `Tool error:`) NO se consideran terminales y caen en
 * el flujo HITL normal.
 */
export function isKnownTerminalToolResult(content: string): boolean {
  if (content === OPERATOR_DENIED_TOOL_CONTENT) return true;
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") return true;
  } catch {
    /* el contenido no es JSON; cae al flujo normal */
  }
  return false;
}

/** Tool call crítico emitido por el modelo sin `ToolMessage` de ejecución (HITL no expuesto). */
export function findUnresolvedCriticalToolApproval(result: unknown): HitlApprovalPayload | undefined {
  if (!result || typeof result !== "object") return undefined;
  const messages = (result as { messages?: unknown[] }).messages;
  if (!Array.isArray(messages)) return undefined;

  const answered = new Set<string>();
  for (const m of messages) {
    if (m instanceof ToolMessage && m.tool_call_id) answered.add(m.tool_call_id);
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue;
    for (const tc of m.tool_calls) {
      const name = tc.name;
      if (!name || !CRITICAL_TOOL_NAMES.has(name)) continue;
      const tid = tc.id ?? "call";
      if (!answered.has(tid)) {
        return {
          kind: "tool_approval",
          tool: name,
          args: (tc.args as Record<string, unknown>) ?? {},
          tool_call_id: tid,
        };
      }
    }
  }
  return undefined;
}

export function resolveDeleteCustomerIdFromText(userText: string): string | undefined {
  const direct = /\b(cust-\d+)\b/i.exec(userText)?.[1];
  if (direct) return direct;

  const lower = userText.toLowerCase();
  for (const [hint, id] of Object.entries(DEMO_NAME_HINTS)) {
    if (lower.includes(hint)) return id;
  }
  return undefined;
}

export async function resolveDeleteCustomerId(env: Env, userText: string): Promise<string | undefined> {
  const direct = resolveDeleteCustomerIdFromText(userText);
  if (direct?.match(/^cust-\d+$/i)) return direct;

  const namePatterns = [
    /cliente\s+(?:denominado\s+)?["“]?(.+?)["”]?(?:\s+del\s|\s*$|[,.])/i,
    /(?:elimina|borra|delete).*?(?:cliente|customer)\s+(.+?)(?:\s+del\s|\s*$|[,.])/i,
  ];

  const tools = createCrmTools(env.DB);
  const queriedNames = new Set<string>();

  for (const re of namePatterns) {
    const match = re.exec(userText);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || /\bcust-\d+\b/i.test(name)) continue;

    const nameKey = name.toLowerCase();
    if (queriedNames.has(nameKey)) continue;
    queriedNames.add(nameKey);

    const raw = await tools.findCustomerByName.invoke({ name });
    try {
      const parsed = JSON.parse(String(raw)) as { items?: Array<{ id?: string }> };
      if (parsed.items?.[0]?.id) return parsed.items[0].id;
    } catch {
      /* ignorar JSON malformado de la tool */
    }
  }

  return undefined;
}

/**
 * Router detectó borrado pero el LLM no invocó la tool (común con Responses API).
 * Sintetiza el mismo payload que `interrupt()` en tools_node para cerrar el demo HITL.
 *
 * PAN-39: si en el historial ya hubo un resultado terminal (`Customer not found`, denegación
 * previa, etc.) para `delete_customer_record` con el mismo `customer_id`, devuelve `undefined`
 * para no volver a pedir aprobación al operador.
 */
export async function resolveSyntheticDeleteHitl(
  env: Env,
  result: unknown,
  userText: string
): Promise<HitlApprovalPayload | undefined> {
  if (!result || typeof result !== "object") return undefined;
  if (findUnresolvedCriticalToolApproval(result)) return undefined;

  const intent = String((result as { intent?: string }).intent ?? "");
  if (!/delete_customer/i.test(intent)) return undefined;

  const customerId = await resolveDeleteCustomerId(env, userText);
  if (!customerId) return undefined;

  const messages = (result as { messages?: BaseMessage[] }).messages;
  if (Array.isArray(messages)) {
    const previous = findPreviousToolResultForCall(messages, "delete_customer_record", {
      customer_id: customerId,
    });
    if (previous !== undefined && isKnownTerminalToolResult(previous)) return undefined;
  }

  return {
    kind: "tool_approval",
    synthetic: true,
    tool: "delete_customer_record",
    args: { customer_id: customerId },
    tool_call_id: `pending-delete-${customerId}`,
  };
}

/** @deprecated Usar `resolveSyntheticDeleteHitl` (async, con DB y nombre). */
export function synthesizeHitlForDeleteIntent(result: unknown, userText: string): HitlApprovalPayload | undefined {
  if (!result || typeof result !== "object") return undefined;
  if (findUnresolvedCriticalToolApproval(result)) return undefined;

  const intent = String((result as { intent?: string }).intent ?? "");
  if (!/delete_customer/i.test(intent)) return undefined;

  const customerId = resolveDeleteCustomerIdFromText(userText);
  if (!customerId) return undefined;

  return {
    kind: "tool_approval",
    synthetic: true,
    tool: "delete_customer_record",
    args: { customer_id: customerId },
    tool_call_id: `pending-delete-${customerId}`,
  };
}

export function readSyntheticHitlPending(toolState: Record<string, unknown> | undefined): HitlApprovalPayload | undefined {
  const raw = toolState?.[SYNTHETIC_HITL_PENDING_KEY];
  if (!raw || typeof raw !== "object") return undefined;
  const payload = raw as HitlApprovalPayload;
  if (payload.kind !== "tool_approval" || !payload.synthetic) return undefined;
  return payload;
}
