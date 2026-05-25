import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import type { GraphState } from "../state.js";
import { createToolsNode } from "./tools.js";

/**
 * `interrupt` se reemplaza por una función observable: por defecto lanza para que el test
 * detecte una interrupción real. En cada caso podemos sobrescribir con
 * `interruptMock.mockImplementationOnce(() => ({ approved: true }))` para simular respuestas.
 */
const interruptMock = vi.fn();

vi.mock("@langchain/langgraph", () => ({
  interrupt: (payload: unknown) => interruptMock(payload),
}));

const deleteInvoke = vi.fn();
const findInvoke = vi.fn();
const getInvoke = vi.fn();

vi.mock("../tools/crm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools/crm.js")>();
  return {
    ...actual,
    getToolsForIndustry: () => [
      { name: "find_customer_by_name", invoke: (...a: unknown[]) => findInvoke(...a) },
      { name: "get_customer_data", invoke: (...a: unknown[]) => getInvoke(...a) },
      { name: "delete_customer_record", invoke: (...a: unknown[]) => deleteInvoke(...a) },
    ],
  };
});

function buildState(messages: GraphState["messages"]): GraphState {
  return {
    messages,
    industry: "retail",
    intent: "delete_customer",
    toolState: {},
    validationPass: false,
    policyFeedback: "",
    retryCount: 0,
  };
}

function buildEnv(customerExists: boolean): Env {
  const first = vi.fn().mockResolvedValue(customerExists ? { id: "cust-001" } : null);
  const bind = vi.fn().mockReturnValue({ first, all: vi.fn(), run: vi.fn() });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { DB: { prepare } } as unknown as Env;
}

describe("tools_node — PAN-39 pre-checks de delete_customer_record", () => {
  beforeEach(() => {
    interruptMock.mockReset();
    interruptMock.mockImplementation(() => {
      throw new Error("interrupt() should not be called in this test");
    });
    deleteInvoke.mockReset();
    findInvoke.mockReset();
    getInvoke.mockReset();
  });

  it("cliente inexistente: ejecuta la tool directamente y NO interrumpe", async () => {
    deleteInvoke.mockResolvedValueOnce(JSON.stringify({ error: "Customer not found" }));

    const node = createToolsNode(buildEnv(false));
    const state = buildState([
      new HumanMessage("Elimina permanentemente cust-001 del CRM."),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "tc1", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
    ]);

    const out = await node(state);
    expect(interruptMock).not.toHaveBeenCalled();
    expect(deleteInvoke).toHaveBeenCalledWith({ customer_id: "cust-001" });
    const msgs = out.messages as ToolMessage[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].tool_call_id).toBe("tc1");
    expect(String(msgs[0].content)).toContain("Customer not found");
  });

  it("denegación previa para mismo customer_id: reusa el ToolMessage sin interrumpir", async () => {
    const node = createToolsNode(buildEnv(true));
    const state = buildState([
      new HumanMessage("Elimina cust-001"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "prev-tc", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({ content: "Operator denied this CRM mutation.", tool_call_id: "prev-tc" }),
      new HumanMessage("Elimina cust-001 otra vez"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "tc2", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
    ]);

    const out = await node(state);
    expect(interruptMock).not.toHaveBeenCalled();
    expect(deleteInvoke).not.toHaveBeenCalled();
    const msgs = out.messages as ToolMessage[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].tool_call_id).toBe("tc2");
    expect(String(msgs[0].content)).toBe("Operator denied this CRM mutation.");
  });

  it("Customer not found previo para mismo id: reusa el resultado sin interrumpir ni consultar D1", async () => {
    const env = buildEnv(true);
    const node = createToolsNode(env);
    const state = buildState([
      new HumanMessage("Elimina cust-001"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "prev-tc", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
      new ToolMessage({
        content: JSON.stringify({ error: "Customer not found" }),
        tool_call_id: "prev-tc",
      }),
      new HumanMessage("Elimina cust-001 otra vez"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "tc3", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
      }),
    ]);

    const out = await node(state);
    expect(interruptMock).not.toHaveBeenCalled();
    expect(deleteInvoke).not.toHaveBeenCalled();
    expect((env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled();
    const msgs = out.messages as ToolMessage[];
    expect(msgs).toHaveLength(1);
    expect(String(msgs[0].content)).toContain("Customer not found");
  });

  it("cliente existente sin antecedentes: SÍ pide aprobación (camino HITL normal)", async () => {
    interruptMock.mockReset();
    interruptMock.mockImplementationOnce(() => ({ approved: true }));
    deleteInvoke.mockResolvedValueOnce(JSON.stringify({ ok: true, deleted_id: "cust-002" }));

    const node = createToolsNode(buildEnv(true));
    const state = buildState([
      new HumanMessage("Elimina cust-002"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "tc4", name: "delete_customer_record", args: { customer_id: "cust-002" } }],
      }),
    ]);

    const out = await node(state);
    expect(interruptMock).toHaveBeenCalledTimes(1);
    expect(interruptMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tool_approval", tool: "delete_customer_record" })
    );
    expect(deleteInvoke).toHaveBeenCalledWith({ customer_id: "cust-002" });
    const msgs = out.messages as ToolMessage[];
    expect(String(msgs[0].content)).toContain("ok");
  });

  it("cliente existente sin antecedentes y operador deniega: emite mensaje de denegación", async () => {
    interruptMock.mockReset();
    interruptMock.mockImplementationOnce(() => ({ approved: false }));

    const node = createToolsNode(buildEnv(true));
    const state = buildState([
      new HumanMessage("Elimina cust-002"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "tc5", name: "delete_customer_record", args: { customer_id: "cust-002" } }],
      }),
    ]);

    const out = await node(state);
    expect(interruptMock).toHaveBeenCalledTimes(1);
    expect(deleteInvoke).not.toHaveBeenCalled();
    const msgs = out.messages as ToolMessage[];
    expect(String(msgs[0].content)).toBe("Operator denied this CRM mutation.");
  });

  it("tool no crítica nunca interrumpe", async () => {
    findInvoke.mockResolvedValueOnce(JSON.stringify({ items: [], count: 0 }));

    const node = createToolsNode(buildEnv(true));
    const state = buildState([
      new HumanMessage("Busca clientes"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "tc6", name: "find_customer_by_name", args: { name: "Acme" } }],
      }),
    ]);

    await node(state);
    expect(interruptMock).not.toHaveBeenCalled();
    expect(findInvoke).toHaveBeenCalled();
  });
});
