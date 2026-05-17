import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { CRITICAL_TOOL_NAMES } from "./tools/crm.js";

/** Tool call crítico emitido por el modelo sin `ToolMessage` de ejecución (HITL no expuesto). */
export function findUnresolvedCriticalToolApproval(result: unknown): unknown | undefined {
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
          args: tc.args ?? {},
          tool_call_id: tid,
        };
      }
    }
  }
  return undefined;
}

/**
 * Router detectó borrado pero el LLM no invocó la tool (común con Responses API).
 * Sintetiza el mismo payload que `interrupt()` en tools_node para cerrar el demo HITL.
 */
export function synthesizeHitlForDeleteIntent(result: unknown, userText: string): unknown | undefined {
  if (!result || typeof result !== "object") return undefined;
  if (findUnresolvedCriticalToolApproval(result)) return undefined;

  const intent = String((result as { intent?: string }).intent ?? "");
  if (!/delete_customer/i.test(intent)) return undefined;

  const customerId = /\b(cust-\d+)\b/i.exec(userText)?.[1];
  if (!customerId) return undefined;

  return {
    kind: "tool_approval",
    tool: "delete_customer_record",
    args: { customer_id: customerId },
    tool_call_id: "pending-delete",
  };
}
