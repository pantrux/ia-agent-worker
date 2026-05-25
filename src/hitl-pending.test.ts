import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import {
  findPreviousToolResultForCall,
  findUnresolvedCriticalToolApproval,
  isKnownTerminalToolResult,
  OPERATOR_DENIED_TOOL_CONTENT,
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

describe("isKnownTerminalToolResult", () => {
  it("acepta denegación textual del operador", () => {
    expect(isKnownTerminalToolResult(OPERATOR_DENIED_TOOL_CONTENT)).toBe(true);
  });

  it("acepta JSON con error string", () => {
    expect(isKnownTerminalToolResult(JSON.stringify({ error: "Customer not found" }))).toBe(true);
    expect(isKnownTerminalToolResult(JSON.stringify({ error: "Order not found" }))).toBe(true);
  });

  it("rechaza éxito y errores transitorios sin estructura conocida", () => {
    expect(isKnownTerminalToolResult(JSON.stringify({ ok: true, deleted_id: "cust-001" }))).toBe(false);
    expect(isKnownTerminalToolResult("Tool error: timeout")).toBe(false);
    expect(isKnownTerminalToolResult("texto libre")).toBe(false);
  });

  it("rechaza JSON con error no string (defensivo)", () => {
    expect(isKnownTerminalToolResult(JSON.stringify({ error: 500 }))).toBe(false);
  });
});

describe("findPreviousToolResultForCall", () => {
  it("encuentra el ToolMessage previo emparejado por name+args", () => {
    const messages = [
      new HumanMessage("Elimina cust-001"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "prev", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({
        content: JSON.stringify({ error: "Customer not found" }),
        tool_call_id: "prev",
      }),
    ];
    expect(
      findPreviousToolResultForCall(messages, "delete_customer_record", { customer_id: "cust-001" })
    ).toContain("Customer not found");
  });

  it("ignora otras tools y customer_ids distintos", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "p1", name: "delete_customer_record", args: { customer_id: "cust-002" } }],
      }),
      new ToolMessage({ content: "Operator denied this CRM mutation.", tool_call_id: "p1" }),
    ];
    expect(
      findPreviousToolResultForCall(messages, "delete_customer_record", { customer_id: "cust-001" })
    ).toBeUndefined();
  });

  it("devuelve el resultado más reciente cuando hay varios", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "old", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "old" }),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "new", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({ content: OPERATOR_DENIED_TOOL_CONTENT, tool_call_id: "new" }),
    ];
    expect(
      findPreviousToolResultForCall(messages, "delete_customer_record", { customer_id: "cust-001" })
    ).toBe(OPERATOR_DENIED_TOOL_CONTENT);
  });
});

describe("resolveSyntheticDeleteHitl con resultado terminal previo (PAN-39)", () => {
  it("no sintetiza si ya hubo Customer not found para mismo customer_id", async () => {
    const messages = [
      new HumanMessage("Elimina cust-001"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "prev", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({
        content: JSON.stringify({ error: "Customer not found" }),
        tool_call_id: "prev",
      }),
    ];
    const pending = await resolveSyntheticDeleteHitl(
      { DB: {} } as Env,
      { intent: "delete_customer", messages },
      "Elimina cust-001 otra vez"
    );
    expect(pending).toBeUndefined();
  });

  it("no sintetiza si hubo denegación previa para mismo customer_id", async () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "prev", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({ content: OPERATOR_DENIED_TOOL_CONTENT, tool_call_id: "prev" }),
    ];
    const pending = await resolveSyntheticDeleteHitl(
      { DB: {} } as Env,
      { intent: "delete_customer", messages },
      "Borra Acme Retail"
    );
    expect(pending).toBeUndefined();
  });
});
