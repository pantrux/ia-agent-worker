import { describe, expect, it } from "vitest";
import { extractLastAiReply } from "./chat-reply.js";

describe("extractLastAiReply", () => {
  it("extrae content string del último mensaje", () => {
    const reply = extractLastAiReply({
      messages: [{ content: "primero" }, { content: "último" }],
    } as never);
    expect(reply).toBe("último");
  });

  it("devuelve vacío si no hay mensajes", () => {
    expect(extractLastAiReply({ messages: [] } as never)).toBe("");
  });
});
