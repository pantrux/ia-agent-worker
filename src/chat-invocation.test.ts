import { describe, expect, it } from "vitest";
import {
  extractGraphInterruptValue,
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
});

describe("throwIfGraphInterrupted", () => {
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
