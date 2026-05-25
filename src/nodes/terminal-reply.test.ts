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

function aiToolCall(name: string, id: string, args: Record<string, unknown> = {}): AIMessage {
  return new AIMessage({ content: "", tool_calls: [{ name, args, id }] });
}

describe("formatTerminalReply", () => {
  it("usa el copy específico de borrado cuando el tool call es `delete_customer_record`", () => {
    const tm = new ToolMessage({
      content: JSON.stringify({ error: "Customer not found" }),
      tool_call_id: "tc-1",
    });
    const reply = formatTerminalReply(tm, "delete_customer_record");
    expect(reply).toMatch(/no se pudo eliminar el cliente/i);
    expect(reply).toMatch(/no existe/i);
  });

  it("cae a copy genérico cuando el tool name es desconocido o no es delete", () => {
    const tm = new ToolMessage({
      content: JSON.stringify({ error: "Customer not found" }),
      tool_call_id: "tc-1",
    });
    expect(formatTerminalReply(tm, "future_critical_tool")).toMatch(/no se pudo completar la operación/i);
    expect(formatTerminalReply(tm)).toMatch(/no se pudo completar la operación/i);
  });

  it("traduce denegación del operador a reply localizado", () => {
    const tm = new ToolMessage({
      content: OPERATOR_DENIED_TOOL_CONTENT,
      tool_call_id: "tc-2",
    });
    expect(formatTerminalReply(tm, "delete_customer_record")).toMatch(/cancelada por el operador/i);
  });

  it("usa el `error` JSON como complemento para mensajes genéricos", () => {
    const tm = new ToolMessage({
      content: JSON.stringify({ error: "Order locked" }),
      tool_call_id: "tc-3",
    });
    const reply = formatTerminalReply(tm, "delete_customer_record");
    expect(reply).toMatch(/no se pudo completar la operación/i);
    expect(reply).toMatch(/Order locked/);
  });

  it("cae a un texto genérico si el contenido no es JSON ni denegación", () => {
    const tm = new ToolMessage({ content: "garbage", tool_call_id: "tc-4" });
    expect(formatTerminalReply(tm, "delete_customer_record")).toMatch(/no se pudo completar la operación/i);
  });
});

describe("lastBatchIsAllTerminal", () => {
  it("`true` cuando todos los tool calls del batch son críticos y terminales", () => {
    const state = makeState({
      messages: [
        new HumanMessage("delete cust-001"),
        aiToolCall("delete_customer_record", "tc-1"),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(true);
  });

  it("`false` cuando el tool call no es crítico (caso `find_customer_by_name` con error)", () => {
    const state = makeState({
      messages: [
        new HumanMessage("buscar cliente Acme"),
        aiToolCall("find_customer_by_name", "tc-a", { name: "Acme" }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-a" }),
      ],
      toolState: { last_executed_batch: ["tc-a"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
  });

  it("`false` cuando el batch mezcla crítico terminal + no crítico (debe ir a model)", () => {
    const state = makeState({
      messages: [
        new HumanMessage("hello"),
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "find_customer_by_name", args: { name: "Acme" }, id: "tc-a" },
            { name: "delete_customer_record", args: { customer_id: "cust-001" }, id: "tc-b" },
          ],
        }),
        new ToolMessage({ content: JSON.stringify({ items: [{ id: "cust-001" }] }), tool_call_id: "tc-a" }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-b" }),
      ],
      toolState: { last_executed_batch: ["tc-a", "tc-b"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
  });

  it("`false` cuando algún `ToolMessage` del batch no es terminal (éxito)", () => {
    const state = makeState({
      messages: [
        aiToolCall("delete_customer_record", "tc-1"),
        new ToolMessage({ content: JSON.stringify({ ok: true }), tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
  });

  it("`false` cuando no hay batch registrado (estado inicial)", () => {
    expect(lastBatchIsAllTerminal(makeState({ toolState: {} }))).toBe(false);
  });

  it("`false` cuando el batch no se puede mapear a un AIMessage con tool_calls", () => {
    const state = makeState({
      messages: [
        new HumanMessage("delete cust-001"),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-orphan" }),
      ],
      toolState: { last_executed_batch: ["tc-orphan"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
  });

  it("`false` cuando faltan `ToolMessage` para alguno de los IDs del batch (defensive)", () => {
    const state = makeState({
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "delete_customer_record", args: { customer_id: "cust-001" }, id: "tc-1" },
            { name: "delete_customer_record", args: { customer_id: "cust-002" }, id: "tc-2" },
          ],
        }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1", "tc-2"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
  });

  it("ignora `ToolMessage` duplicados con el mismo `tool_call_id` y exige cobertura completa del batch", () => {
    const state = makeState({
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "delete_customer_record", args: { customer_id: "cust-001" }, id: "tc-1" },
            { name: "delete_customer_record", args: { customer_id: "cust-002" }, id: "tc-2" },
          ],
        }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1", "tc-2"] },
    });
    expect(lastBatchIsAllTerminal(state)).toBe(false);
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
        aiToolCall("delete_customer_record", "tc-1"),
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
        aiToolCall("delete_customer_record", "tc-1"),
        new ToolMessage({ content: OPERATOR_DENIED_TOOL_CONTENT, tool_call_id: "tc-1" }),
      ],
      toolState: { last_executed_batch: ["tc-1"] },
    });
    const result = await node(state);
    const msgs = result.messages as AIMessage[];
    expect(msgs[0].content).toMatch(/cancelada por el operador/i);
  });

  it("concatena replies únicos cuando el batch tiene múltiples terminales distintos", async () => {
    const node = createTerminalReplyNode();
    const state = makeState({
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "delete_customer_record", args: { customer_id: "cust-001" }, id: "tc-1" },
            { name: "delete_customer_record", args: { customer_id: "cust-002" }, id: "tc-2" },
          ],
        }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
        new ToolMessage({ content: OPERATOR_DENIED_TOOL_CONTENT, tool_call_id: "tc-2" }),
      ],
      toolState: { last_executed_batch: ["tc-1", "tc-2"] },
    });
    const result = await node(state);
    const text = String((result.messages as AIMessage[])[0].content);
    expect(text).toMatch(/no se pudo eliminar el cliente/i);
    expect(text).toMatch(/cancelada por el operador/i);
    expect(text.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("deduplica replies idénticos cuando el batch tiene varios terminales del mismo tipo", async () => {
    const node = createTerminalReplyNode();
    const state = makeState({
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "delete_customer_record", args: { customer_id: "cust-001" }, id: "tc-1" },
            { name: "delete_customer_record", args: { customer_id: "cust-001" }, id: "tc-2" },
          ],
        }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-1" }),
        new ToolMessage({ content: JSON.stringify({ error: "Customer not found" }), tool_call_id: "tc-2" }),
      ],
      toolState: { last_executed_batch: ["tc-1", "tc-2"] },
    });
    const result = await node(state);
    const text = String((result.messages as AIMessage[])[0].content);
    expect(text).toMatch(/no se pudo eliminar el cliente/i);
    expect(text).not.toMatch(/^1\./m);
  });
});
