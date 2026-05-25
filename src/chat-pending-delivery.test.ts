import { describe, expect, it } from "vitest";
import {
  getPendingTelegramDelivery,
  getPendingSlackDelivery,
  putPendingTelegramDelivery,
  putPendingSlackDelivery,
  clearPendingTelegramDelivery,
  telegramPendingDeliveryKey,
  slackPendingDeliveryKey,
} from "./chat-pending-delivery.js";

describe("chat-pending-delivery", () => {
  it("clave estable por chat_id y update_id", () => {
    expect(telegramPendingDeliveryKey("42", "7")).toBe("telegram:pending:42:7");
    expect(slackPendingDeliveryKey("C1", "Ev9")).toBe("slack:pending:C1:Ev9");
  });

  it("put/get/clear roundtrip", async () => {
    const store = new Map<string, string>();
    const putOpts: { expirationTtl?: number }[] = [];
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        store.set(key, value);
        if (opts) putOpts.push(opts);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    };

    const data = { threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", reply: "hola", text: "ping" };
    await putPendingTelegramDelivery(kv as never, "99", "1", data);
    expect(putOpts[0]?.expirationTtl).toBeGreaterThan(0);
    expect(await getPendingTelegramDelivery(kv as never, "99", "1")).toEqual(data);
    expect(await getPendingTelegramDelivery(kv as never, "99", "2")).toBeNull();
    await clearPendingTelegramDelivery(kv as never, "99", "1");
    expect(await getPendingTelegramDelivery(kv as never, "99", "1")).toBeNull();
  });

  it("slack pending roundtrip", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    };
    const data = {
      threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      reply: "ok",
      text: "hola",
    };
    await putPendingSlackDelivery(kv as never, "C1", "Ev1", data);
    expect(await getPendingSlackDelivery(kv as never, "C1", "Ev1")).toEqual(data);
  });
});
