import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import {
  findUnresolvedCriticalToolApproval,
  resolveDeleteCustomerId,
  resolveDeleteCustomerIdFromText,
  resolveSyntheticDeleteHitl,
  synthesizeHitlForDeleteIntent,
} from "./hitl-pending.js";

const findInvoke = vi.fn();

vi.mock("./tools/crm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tools/crm.js")>();
  return {
    ...actual,
    createCrmTools: () => ({
      findCustomerByName: { invoke: (...args: unknown[]) => findInvoke(...args) },
      deleteCustomerRecord: { invoke: vi.fn() },
    }),
  };
});

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

describe("resolveDeleteCustomerIdFromText", () => {
  it("extrae cust-001 del texto", () => {
    expect(
      resolveDeleteCustomerIdFromText("Elimina permanentemente el cliente cust-001 del CRM.")
    ).toBe("cust-001");
  });

  it("resuelve Acme Retail por hint del seed demo", () => {
    expect(resolveDeleteCustomerIdFromText("Borra el cliente Acme Retail del CRM")).toBe("cust-001");
  });
});

describe("synthesizeHitlForDeleteIntent", () => {
  it("sintetiza HITL con synthetic y tool_call_id único", () => {
    const pending = synthesizeHitlForDeleteIntent(
      { intent: "delete_customer", messages: [new AIMessage({ content: "" })] },
      "Elimina permanentemente el cliente cust-001 del CRM."
    );
    expect(pending).toMatchObject({
      synthetic: true,
      tool: "delete_customer_record",
      args: { customer_id: "cust-001" },
      tool_call_id: "pending-delete-cust-001",
    });
  });
});

describe("resolveSyntheticDeleteHitl", () => {
  it("resuelve por hint demo sin consultar D1", async () => {
    const pending = await resolveSyntheticDeleteHitl(
      { DB: {} } as Env,
      { intent: "delete_customer", messages: [] },
      "Elimina el cliente Finance Co del CRM"
    );
    expect(pending).toMatchObject({
      synthetic: true,
      args: { customer_id: "cust-002" },
      tool_call_id: "pending-delete-cust-002",
    });
    expect(findInvoke).not.toHaveBeenCalled();
  });
});

describe("resolveDeleteCustomerId", () => {
  it("usa find_customer_by_name cuando no hay id ni hint demo", async () => {
    findInvoke.mockResolvedValueOnce(JSON.stringify({ items: [{ id: "cust-009" }], count: 1 }));
    const id = await resolveDeleteCustomerId({ DB: {} } as Env, "Elimina el cliente Mystery Corp");
    expect(findInvoke).toHaveBeenCalledWith({ name: "Mystery Corp" });
    expect(id).toBe("cust-009");
  });
});
