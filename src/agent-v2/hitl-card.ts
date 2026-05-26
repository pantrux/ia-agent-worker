import type { HitlCard } from "../canonical/index.js";
import type { HitlApprovalPayload } from "../hitl-pending.js";

const DEFAULT_HITL_TTL_MS = 10 * 60 * 1000;

function sanitizeInterruptId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "pending";
}

export function buildHitlCardFromInterrupt(
  interrupt: HitlApprovalPayload,
  traceId: string,
  now: Date = new Date()
): HitlCard {
  const interruptId = `hitl_${sanitizeInterruptId(interrupt.tool_call_id)}`;
  const expiresAt = new Date(now.getTime() + DEFAULT_HITL_TTL_MS).toISOString();

  let title = "Aprobación requerida";
  let body = `Confirma la acción solicitada: ${interrupt.tool}.`;

  if (interrupt.tool === "delete_customer_record") {
    const customerId = String((interrupt.args as { customer_id?: string }).customer_id ?? "");
    body = customerId
      ? `Confirma si deseas eliminar permanentemente el cliente ${customerId} del CRM.`
      : "Confirma si deseas eliminar permanentemente un cliente del CRM.";
  }

  return {
    interrupt_id: interruptId,
    callback_ref: `unsigned:${traceId}:${interruptId}`,
    title,
    body,
    expires_at: expiresAt,
    actions: [
      { id: "approve", kind: "approve", label: "Aprobar", destructive: true },
      { id: "deny", kind: "deny", label: "Rechazar" }
    ]
  };
}

export function isHitlApprovalPayload(value: unknown): value is HitlApprovalPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as HitlApprovalPayload;
  return payload.kind === "tool_approval" && typeof payload.tool === "string";
}
