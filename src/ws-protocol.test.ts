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
});
