import { describe, expect, it } from "vitest";
import { buildHitlCardFromInterrupt } from "./hitl-card.js";

describe("buildHitlCardFromInterrupt", () => {
  it("maps delete_customer_record interrupts into a canonical HitlCard", () => {
    const now = new Date("2026-05-26T07:10:00.000Z");
    const card = buildHitlCardFromInterrupt(
      {
        kind: "tool_approval",
        tool: "delete_customer_record",
        args: { customer_id: "cust-001" },
        tool_call_id: "call_delete_001"
      },
      "trace_tg_001",
      now
    );

    expect(card).toMatchObject({
      interrupt_id: "hitl_call_delete_001",
      callback_ref: "unsigned:trace_tg_001:hitl_call_delete_001",
      title: "Aprobación requerida",
      body: "Confirma si deseas eliminar permanentemente el cliente cust-001 del CRM.",
      expires_at: "2026-05-26T07:20:00.000Z",
      actions: [
        { id: "approve", kind: "approve", label: "Aprobar", destructive: true },
        { id: "deny", kind: "deny", label: "Rechazar" }
      ]
    });
  });
});
