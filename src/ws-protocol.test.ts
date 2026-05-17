import { describe, expect, it } from "vitest";
import { parseWsClientMessage, serializeWsServerMessage } from "./ws-protocol.js";

describe("ws-protocol", () => {
  it("parses chat message", () => {
    const m = parseWsClientMessage(JSON.stringify({ type: "chat", text: "hola" }));
    expect(m).toEqual({ type: "chat", text: "hola" });
  });

  it("rejects invalid chat", () => {
    expect(parseWsClientMessage(JSON.stringify({ type: "chat", text: "" }))).toBeNull();
  });

  it("parses resume", () => {
    const m = parseWsClientMessage(JSON.stringify({ type: "resume", approved: true }));
    expect(m).toEqual({ type: "resume", approved: true });
  });

  it("serializes server ready", () => {
    const s = serializeWsServerMessage({
      type: "ready",
      session_id: "s1",
      thread_id: null,
    });
    expect(JSON.parse(s)).toEqual({ type: "ready", session_id: "s1", thread_id: null });
  });

  it("serializes reply_delta", () => {
    const s = serializeWsServerMessage({
      type: "reply_delta",
      delta: "Hola",
      thread_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
    expect(JSON.parse(s)).toEqual({
      type: "reply_delta",
      delta: "Hola",
      thread_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
  });

  it("serializes hitl_pending", () => {
    const interrupt = { kind: "tool_approval", tool: "delete_customer_record" };
    const s = serializeWsServerMessage({
      type: "hitl_pending",
      thread_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      interrupt,
    });
    expect(JSON.parse(s)).toEqual({
      type: "hitl_pending",
      thread_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      interrupt,
    });
  });
});
