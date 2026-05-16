import { describe, expect, it } from "vitest";
import {
  getPendingTelegramDelivery,
  putPendingTelegramDelivery,
  clearPendingTelegramDelivery,
  telegramPendingDeliveryKey,
} from "./chat-pending-delivery.js";

describe("chat-pending-delivery", () => {
  it("clave estable por chat_id", () => {
    expect(telegramPendingDeliveryKey("42")).toBe("telegram:pending:42");
  });

  it("put/get/clear roundtrip", async () => {
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

    const data = { threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", reply: "hola", text: "ping" };
    await putPendingTelegramDelivery(kv as never, "99", data);
    expect(await getPendingTelegramDelivery(kv as never, "99")).toEqual(data);
    await clearPendingTelegramDelivery(kv as never, "99");
    expect(await getPendingTelegramDelivery(kv as never, "99")).toBeNull();
  });
});
