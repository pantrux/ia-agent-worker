import { describe, expect, it, vi } from "vitest";
import { emitStreamedTextDeltas } from "./responses-client.js";

describe("responses-client streaming helpers", () => {
  it("emitStreamedTextDeltas envía trozos y cede entre ellos", async () => {
    const deltas: string[] = [];
    await emitStreamedTextDeltas("abcdefgh", (d) => deltas.push(d), 3);
    expect(deltas.join("")).toBe("abcdefgh");
    expect(deltas.length).toBeGreaterThan(1);
  });

  it("emitStreamedTextDeltas ignora texto vacío", async () => {
    const onDelta = vi.fn();
    await emitStreamedTextDeltas("   ", onDelta);
    expect(onDelta).not.toHaveBeenCalled();
  });
});
