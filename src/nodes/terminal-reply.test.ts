import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  createTerminalReplyNode,
  formatTerminalReply,
  lastBatchIsAllTerminal,
} from "./terminal-reply.js";
import { OPERATOR_DENIED_TOOL_CONTENT } from "../hitl-pending.js";
import {
  CHAT_WS_REPLY_RESET_KEY,
  CHAT_WS_TOKEN_DELTA_KEY,
} from "../chat-ws-stream.js";
import type { GraphState } from "../state.js";

function makeState(partial: Partial<GraphState>): GraphState {
  return {
    messages: [],
    industry: "unknown",
    intent: "",
    toolState: {},
    validationPass: false,
    policyFeedback: "",
    retryCount: 0,
    ...partial,
  } as GraphState;
}

describe("formatTerminalReply", () => {
  it("traduce `Customer not found` a un reply localizado y específico", () => {
    const tm = new ToolMessage({
      content: JSON.stringify({ error: "Customer not found" }),
      tool_call_id: "tc-1",
    });
    expect(formatTerminalReply(tm)).toMatch(/no se pudo eliminar el cliente/i);
    expect(formatTerminalReply(tm)).toMatch(/no existe/i);
  });

  it("traduce denegación del operador a reply localizado", () => {
    const tm = new ToolMessage({
      content: OPERATOR_DENIED_TOOL_CONTENT,
      tool_call_id: "tc-2",
    });
    expect(formatTerminalReply(tm)).toMatch(/cancelada por el operador/i);
  });

  it("usa el `error` JSON como complemento para mensajes genéricos", () => {
    const tm = new ToolMessage({
      content: JSON.stringify({ error: "Order locked" }),
      tool_call_id: "tc-3",
    });
    expect(formatTerminalReply(tm)).toMatch(/no se pudo completar la operación/i);
    expect(formatTerminalReply(tm)).toMatch(/Order locked/);
  });

  it("cae a un texto genérico si el contenido no es JSON ni denegación", () => {
    const tm = new ToolMessage({ content: "garbage", tool_call_id: "tc-4" });
    expect(formatTerminalReply(tm)).toMatch(/no se pudo completar la operación/i);
  });
});

describe("lastBatchIsAllTerminal", () => {
  it("`true` cuando todos los `ToolMessage` del último batch son terminales", () => {
    const state = makeState({
      messages: [
        new HumanMessage("delete cust-001"),
        new AIMessage({ content: "", tool_calls: [{ name: "delete_customer_record", args: {}, id: "tc-1" }] }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(true);
  });

  it("`false` cuando algún `ToolMessage` del batch es éxito (no terminal)", () => {
    const state = makeState({
      messages: [
        new HumanMessage("hello"),
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "find_customer_by_name", args: { name: "Acme" }, id: "tc-a" },
            { name: "delete_customer_record", args: {}, id: "tc-b" },
          ],
        }),
        new ToolMessage({ content: JSON.stringify({ items: [{ id: "cust-001" }] }), tool_call_id: "tc-a" }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-b" }),
      ],
      toolState: { last_executed_batch: ["tc-a", "tc-b"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
  });

  it("`false` cuando no hay batch registrado (estado inicial)", () => {
    expect(lastBatchIsAllTerminal(makeState({ toolState: {} }))).toBe(false);
  });
});

describe("createTerminalReplyNode", () => {
  it("emite `reply_reset` + `reply_delta` y devuelve un `AIMessage` final sin invocar LLM", async () => {
    const onReplyReset = vi.fn();
    const onTokenDelta = vi.fn();
    const node = createTerminalReplyNode();
    const state = makeState({
      messages: [
        new HumanMessage("delete cust-001"),
        new AIMessage({ content: "", tool_calls: [{ name: "delete_customer_record", args: {}, id: "tc-1" }] }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1"] },
    });

    const config = {
      configurable: {
        [CHAT_WS_REPLY_RESET_KEY]: onReplyReset,
        [CHAT_WS_TOKEN_DELTA_KEY]: onTokenDelta,
      },
    };
    const result = await node(state, config);

    expect(onReplyReset).toHaveBeenCalledTimes(1);
    expect(onTokenDelta).toHaveBeenCalledTimes(1);
    expect(onTokenDelta.mock.calls[0][0]).toMatch(/no existe/i);

    const msgs = result.messages as AIMessage[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBeInstanceOf(AIMessage);
    expect(typeof msgs[0].content).toBe("string");
    expect(msgs[0].content).toMatch(/no se pudo eliminar el cliente/i);
    expect((result.toolState as Record<string, unknown>).terminal_reply).toBe(true);
  });

  it("funciona sin handlers WS configurados (path no streaming)", async () => {
    const node = createTerminalReplyNode();
    const state = makeState({
      messages: [
        new AIMessage({ content: "", tool_calls: [{ name: "delete_customer_record", args: {}, id: "tc-1" }] }),
        new ToolMessage({ content: OPERATOR_DENIED_TOOL_CONTENT, tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1"] },
    });
    const result = await node(state);
    const msgs = result.messages as AIMessage[];
    expect(msgs[0].content).toMatch(/cancelada por el operador/i);
  });
});
