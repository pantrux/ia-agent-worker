import { describe, expect, it } from "vitest";
import { signWsTicket, verifyWsTicket } from "./ws-ticket.js";

describe("ws-ticket", () => {
  const secret = "test-secret-pan19";

  it("round-trips valid ticket", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const ticket = await signWsTicket(secret, {
      sessionId: "sess-1",
      userId: "user-uuid",
      nowSec,
    });
    const payload = await verifyWsTicket(secret, ticket);
    expect(payload?.sid).toBe("sess-1");
    expect(payload?.uid).toBe("user-uuid");
    expect(payload?.exp).toBe(nowSec + 60);
  });

  it("rejects expired ticket", async () => {
    const ticket = await signWsTicket(secret, {
      sessionId: "sess-2",
      nowSec: 1_000,
    });
    const payload = await verifyWsTicket(secret, ticket);
    expect(payload).toBeNull();
  });

  it("rejects tampered ticket", async () => {
    const ticket = await signWsTicket(secret, { sessionId: "sess-3", nowSec: 1_700_000_000 });
    const payload = await verifyWsTicket(secret, `${ticket}x`);
    expect(payload).toBeNull();
  });
});
