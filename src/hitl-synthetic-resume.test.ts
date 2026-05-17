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
  const baseState: GraphState = {
    messages: [],
    industry: "retail",
    intent: "delete_customer",
    toolState: { synthetic_hitl_pending: { synthetic: true } },
    validationPass: false,
    policyFeedback: "",
    retryCount: 0,
  };

  const pending = {
    kind: "tool_approval" as const,
    synthetic: true,
    tool: "delete_customer_record",
    args: { customer_id: "cust-001" },
    tool_call_id: "pending-delete-cust-001",
  };

  it("aprobado ejecuta delete_customer_record y responde en español", async () => {
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
    expect(updateState).toHaveBeenCalled();
    expect(result.toolState?.synthetic_hitl_pending).toBeUndefined();
    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toContain("cust-001");
    expect(String(last.content)).toContain("eliminado");
  });

  it("denegado no llama a delete y devuelve mensaje de rechazo", async () => {
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
    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toMatch(/denegad/i);
  });
});
