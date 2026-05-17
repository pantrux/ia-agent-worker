import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { Env } from "./env.js";
import { CRITICAL_TOOL_NAMES, createCrmTools } from "./tools/crm.js";

export const SYNTHETIC_HITL_PENDING_KEY = "synthetic_hitl_pending";

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

  for (const re of namePatterns) {
    const match = re.exec(userText);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || /\bcust-\d+\b/i.test(name)) continue;

    const tools = createCrmTools(env.DB);
    const raw = await tools.findCustomerByName.invoke({ name });
    try {
      const parsed = JSON.parse(String(raw)) as { items?: Array<{ id?: string }> };
      if (parsed.items?.[0]?.id) return parsed.items[0].id;
    } catch {
      /* ignore malformed tool JSON */
    }
  }

  return resolveDeleteCustomerIdFromText(userText);
}

/**
 * Router detectó borrado pero el LLM no invocó la tool (común con Responses API).
 * Sintetiza el mismo payload que `interrupt()` en tools_node para cerrar el demo HITL.
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
