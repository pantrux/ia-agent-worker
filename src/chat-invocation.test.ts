import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  extractGraphInterruptValue,
  hasGraphInterrupt,
  isGraphInterruptError,
  throwIfGraphInterrupted,
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
