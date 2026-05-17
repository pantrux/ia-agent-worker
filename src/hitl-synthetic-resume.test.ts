import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import { executeSyntheticHitlResume, snapshotHasPendingInterrupt } from "./hitl-synthetic-resume.js";
import type { GraphState } from "./state.js";

const deleteInvoke = vi.fn();

vi.mock("./tools/crm.js", () => ({
  createCrmTools: () => ({
    deleteCustomerRecord: { invoke: (...args: unknown[]) => deleteInvoke(...args) },
    findCustomerByName: { invoke: vi.fn() },
  }),
}));

describe("snapshotHasPendingInterrupt", () => {
  it("detecta interrupts en tasks", () => {
    expect(snapshotHasPendingInterrupt({ tasks: [{ interrupts: [{}] }] })).toBe(true);
    expect(snapshotHasPendingInterrupt({ tasks: [{ interrupts: [] }] })).toBe(false);
    expect(snapshotHasPendingInterrupt({})).toBe(false);
  });
});

describe("executeSyntheticHitlResume", () => {
  const pending = {
    kind: "tool_approval" as const,
    synthetic: true,
    tool: "delete_customer_record",
    args: { customer_id: "cust-001" },
    tool_call_id: "pending-delete-cust-001",
  };

  const baseState: GraphState = {
    messages: [new HumanMessage("Elimina cust-001")],
    industry: "retail",
    intent: "delete_customer",
    toolState: { synthetic_hitl_pending: { synthetic: true } },
    validationPass: false,
    policyFeedback: "",
    retryCount: 0,
  };

  it("aprobado ejecuta delete, persiste Tool+AI y conserva historial", async () => {
    deleteInvoke.mockResolvedValueOnce(JSON.stringify({ ok: true, deleted_id: "cust-001" }));
    const updateState = vi.fn().mockResolvedValue(undefined);
    const graph = { updateState };

    const result = await executeSyntheticHitlResume(
      { DB: {} } as Env,
      graph,
      { configurable: { thread_id: "t1" } },
      { approved: true },
      pending,
      baseState
    );

    expect(deleteInvoke).toHaveBeenCalledWith({ customer_id: "cust-001" });
    expect(updateState).toHaveBeenCalledTimes(2);
    const lastPersist = updateState.mock.calls[1][1];
    expect(lastPersist.messages).toHaveLength(2);
    expect(result.messages).toHaveLength(3);
    expect(result.toolState?.synthetic_hitl_pending).toBeUndefined();
    expect(String(result.messages[2].content)).toContain("eliminado");
  });

  it("denegado no llama a delete y persiste Tool+AI", async () => {
    deleteInvoke.mockClear();
    const updateState = vi.fn().mockResolvedValue(undefined);
    const graph = { updateState };

    const result = await executeSyntheticHitlResume(
      { DB: {} } as Env,
      graph,
      {},
      { approved: false },
      pending,
      baseState
    );

    expect(deleteInvoke).not.toHaveBeenCalled();
    const lastPersist = updateState.mock.calls[1][1];
    expect(lastPersist.messages).toHaveLength(2);
    expect(String(result.messages[result.messages.length - 1].content)).toMatch(/denegad/i);
  });

  it("sin customer_id no invoca delete", async () => {
    deleteInvoke.mockClear();
    const updateState = vi.fn().mockResolvedValue(undefined);
    const graph = { updateState };

    await executeSyntheticHitlResume(
      { DB: {} } as Env,
      graph,
      {},
      { approved: true },
      { ...pending, args: {} },
      baseState
    );

    expect(deleteInvoke).not.toHaveBeenCalled();
  });

  it("error de CRM devuelve mensaje en español", async () => {
    deleteInvoke.mockRejectedValueOnce(new Error("DB timeout"));
    const updateState = vi.fn().mockResolvedValue(undefined);
    const graph = { updateState };

    const result = await executeSyntheticHitlResume(
      { DB: {} } as Env,
      graph,
      {},
      { approved: true },
      pending,
      baseState
    );

    expect(String(result.messages[result.messages.length - 1].content)).toMatch(/error interno/i);
  });
});
