import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import {
  extractGraphInterruptValue,
  hasGraphInterrupt,
  isGraphInterruptError,
  throwIfGraphInterrupted,
  runChatMessageGraph,
} from "./chat-invocation.js";

describe("extractGraphInterruptValue", () => {
  it("lee el último valor de __interrupt__", () => {
    const payload = { kind: "tool_approval", tool: "delete_customer_record" };
    expect(
      extractGraphInterruptValue({
        messages: [],
        __interrupt__: [{ value: payload }],
      })
    ).toEqual(payload);
  });

  it("devuelve undefined si no hay interrupt", () => {
    expect(extractGraphInterruptValue({ messages: [] })).toBeUndefined();
    expect(extractGraphInterruptValue(null)).toBeUndefined();
  });

  it("distingue payload undefined de ausencia de interrupt", () => {
    expect(extractGraphInterruptValue({ __interrupt__: [{ value: undefined }] })).toBeUndefined();
    expect(hasGraphInterrupt({ __interrupt__: [{ value: undefined }] })).toBe(true);
  });
});

describe("throwIfGraphInterrupted", () => {
  it("lanza aunque el payload del interrupt sea undefined", () => {
    expect(() => throwIfGraphInterrupted({ __interrupt__: [{ value: undefined }] })).toThrowError(
      "GraphInterrupt"
    );
    try {
      throwIfGraphInterrupted({ __interrupt__: [{ value: undefined }] });
    } catch (e) {
      expect(isGraphInterruptError(e)).toBe(true);
      expect((e as { value?: unknown }).value).toBeUndefined();
    }
  });

  it("lanza si hay tool call crítico sin ToolMessage", () => {
    expect(() =>
      throwIfGraphInterrupted({
        messages: [
          new AIMessage({
            content: "",
            tool_calls: [{ id: "tc1", name: "delete_customer_record", args: { customer_id: "cust-001" } }],
          }),
        ],
      })
    ).toThrowError("GraphInterrupt");
  });

  it("lanza error compatible con isGraphInterruptError", () => {
    const interrupt = { kind: "tool_approval", tool: "delete_customer_record", args: {} };
    expect(() =>
      throwIfGraphInterrupted({ __interrupt__: [{ value: interrupt }] })
    ).toThrowError("GraphInterrupt");
    try {
      throwIfGraphInterrupted({ __interrupt__: [{ value: interrupt }] });
    } catch (e) {
      expect(isGraphInterruptError(e)).toBe(true);
      expect((e as { value?: unknown }).value).toEqual(interrupt);
    }
  });
});

const graphInvoke = vi.fn();
const graphGetState = vi.fn();
const graphUpdateState = vi.fn();
const deleteInvoke = vi.fn();
const findInvoke = vi.fn();

vi.mock("./graph.js", () => ({
  buildGraph: () => ({
    invoke: (...args: unknown[]) => graphInvoke(...args),
    getState: (...args: unknown[]) => graphGetState(...args),
    updateState: (...args: unknown[]) => graphUpdateState(...args),
  }),
}));

vi.mock("./tools/crm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tools/crm.js")>();
  return {
    ...actual,
    createCrmTools: () => ({
      findCustomerByName: { invoke: (...a: unknown[]) => findInvoke(...a) },
      deleteCustomerRecord: { invoke: (...a: unknown[]) => deleteInvoke(...a) },
    }),
  };
});

type DbStub = "exists" | "missing" | "fail";

function buildEnv(state: DbStub): Env {
  const first = vi.fn().mockImplementation(() => {
    if (state === "fail") return Promise.reject(new Error("D1 unavailable"));
    if (state === "exists") return Promise.resolve({ id: "cust-001" });
    return Promise.resolve(null);
  });
  const bind = vi.fn().mockReturnValue({ first, all: vi.fn(), run: vi.fn() });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { DB: { prepare } } as unknown as Env;
}

describe("runChatMessageGraph — preflight sintético PAN-39", () => {
  beforeEach(() => {
    graphInvoke.mockReset();
    graphGetState.mockReset();
    graphUpdateState.mockReset();
    deleteInvoke.mockReset();
    findInvoke.mockReset();
  });

  it("customer ausente en D1: emite Tool/AI sin pedir aprobación y NO invoca la tool (cierra TOCTOU)", async () => {
    graphInvoke.mockResolvedValueOnce({
      messages: [new HumanMessage("Borra cust-999")],
      intent: "delete_customer",
      industry: "retail",
      toolState: {},
      validationPass: false,
      policyFeedback: "",
      retryCount: 0,
    });
    graphGetState.mockResolvedValueOnce({
      values: {
        messages: [new HumanMessage("Borra cust-999")],
        intent: "delete_customer",
        industry: "retail",
        toolState: {},
        validationPass: false,
        policyFeedback: "",
        retryCount: 0,
      },
      tasks: [],
    });
    graphUpdateState.mockResolvedValue(undefined);

    const result = await runChatMessageGraph(buildEnv("missing"), {
      text: "Por favor elimina permanentemente el cliente cust-999 del CRM.",
      threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      channel: "web",
      userId: "anonymous",
      operation: "chat",
    });

    expect(deleteInvoke).not.toHaveBeenCalled();
    const msgs = result.messages as Array<AIMessage | HumanMessage | ToolMessage>;
    const toolMsg = msgs.find((m) => m instanceof ToolMessage) as ToolMessage | undefined;
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(String(toolMsg!.content)) as { error?: string };
    expect(parsed.error).toBe("Customer not found");
    const lastAi = [...msgs].reverse().find((m) => m instanceof AIMessage) as AIMessage | undefined;
    expect(String(lastAi!.content)).toMatch(/no se pudo eliminar el cliente/i);
  });

  it("customer existente en D1: lanza GraphInterrupt con synthetic payload", async () => {
    graphInvoke.mockResolvedValueOnce({
      messages: [new HumanMessage("Borra cust-001")],
      intent: "delete_customer",
      industry: "retail",
      toolState: {},
      validationPass: false,
      policyFeedback: "",
      retryCount: 0,
    });
    graphUpdateState.mockResolvedValue(undefined);

    await expect(
      runChatMessageGraph(buildEnv("exists"), {
        text: "Por favor elimina permanentemente el cliente cust-001 del CRM.",
        threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        channel: "web",
        userId: "anonymous",
        operation: "chat",
      })
    ).rejects.toMatchObject({
      name: "GraphInterrupt",
      value: expect.objectContaining({
        kind: "tool_approval",
        synthetic: true,
        tool: "delete_customer_record",
        args: { customer_id: "cust-001" },
      }),
    });

    expect(deleteInvoke).not.toHaveBeenCalled();
    expect(graphUpdateState).toHaveBeenCalled();
  });

  it("D1 falla en la preflight: cae al flujo HITL sintético normal", async () => {
    graphInvoke.mockResolvedValueOnce({
      messages: [new HumanMessage("Borra cust-001")],
      intent: "delete_customer",
      industry: "retail",
      toolState: {},
      validationPass: false,
      policyFeedback: "",
      retryCount: 0,
    });
    graphUpdateState.mockResolvedValue(undefined);

    await expect(
      runChatMessageGraph(buildEnv("fail"), {
        text: "Por favor elimina permanentemente el cliente cust-001 del CRM.",
        threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        channel: "web",
        userId: "anonymous",
        operation: "chat",
      })
    ).rejects.toMatchObject({ name: "GraphInterrupt" });

    expect(deleteInvoke).not.toHaveBeenCalled();
  });
});
