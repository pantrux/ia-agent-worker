import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  findUnresolvedCriticalToolApproval,
  synthesizeHitlForDeleteIntent,
} from "./hitl-pending.js";

describe("findUnresolvedCriticalToolApproval", () => {
  it("detecta delete_customer_record sin ToolMessage", () => {
    const pending = findUnresolvedCriticalToolApproval({
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "tc1", name: "delete_customer_record", args: { customer_id: "cust-001" } },
          ],
        }),
      ],
    });
    expect(pending).toMatchObject({
      kind: "tool_approval",
      tool: "delete_customer_record",
      args: { customer_id: "cust-001" },
    });
  });
});

describe("synthesizeHitlForDeleteIntent", () => {
  it("sintetiza HITL si intent delete_customer y cust-001 en el texto", () => {
    const pending = synthesizeHitlForDeleteIntent(
      { intent: "delete_customer", messages: [new AIMessage({ content: "" })] },
      "Elimina permanentemente el cliente cust-001 del CRM."
    );
    expect(pending).toMatchObject({
      tool: "delete_customer_record",
      args: { customer_id: "cust-001" },
    });
  });
});
