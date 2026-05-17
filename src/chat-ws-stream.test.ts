import { describe, expect, it } from "vitest";
import { textDeltaFromMessageContent } from "./chat-ws-stream.js";

describe("chat-ws-stream", () => {
  it("extrae texto plano y partes con text", () => {
    expect(textDeltaFromMessageContent("hola")).toBe("hola");
    expect(textDeltaFromMessageContent([{ type: "text", text: "a" }, "b"])).toBe("ab");
    expect(textDeltaFromMessageContent(null)).toBe("");
  });
});
