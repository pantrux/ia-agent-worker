import { describe, expect, it } from "vitest";
import { classifyChatGraphError } from "./chat-graph-error.js";

describe("classifyChatGraphError", () => {
  it("detecta 429 / quota exceeded", () => {
    const r = classifyChatGraphError(
      new Error("Copilot Responses API failed (429 Too Many Requests): quota exceeded")
    );
    expect(r.code).toBe("rate_limited");
    expect(r.message).toMatch(/saturado|cuota/i);
  });

  it("detecta rate limited de GitHub Models", () => {
    const r = classifyChatGraphError(
      new Error('Copilot Responses API failed (429): {"error":[{"message":"Rate limited"}]}')
    );
    expect(r.code).toBe("rate_limited");
  });

  it("no clasifica 429 embebido en otro token como rate limit", () => {
    const r = classifyChatGraphError(new Error("operation-42999 failed"));
    expect(r.code).toBe("internal_error");
  });

  it("detecta fallo de proveedor", () => {
    const r = classifyChatGraphError(new Error('400 [{"message":"Failed to get response from provider"}]'));
    expect(r.code).toBe("provider_error");
  });

  it("usa mensaje genérico para otros errores", () => {
    expect(classifyChatGraphError(new Error("boom"), "chat").message).toBe("Error al ejecutar el grafo");
    expect(classifyChatGraphError(new Error("boom"), "resume").message).toBe("Error al reanudar el grafo");
  });
});
