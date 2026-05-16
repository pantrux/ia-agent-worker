import { describe, expect, it } from "vitest";
import { telegramChatThreadKey, getTelegramThreadId, putTelegramThreadId } from "./chat-thread-kv.js";

describe("chat-thread-kv", () => {
  it("clave estable por chat_id", () => {
    expect(telegramChatThreadKey("42")).toBe("telegram:chat:42");
  });

  it("get/put roundtrip con KV mock", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    await putTelegramThreadId(kv as never, "99", id);
    expect(await getTelegramThreadId(kv as never, "99")).toBe(id);
  });

  it("sin KV devuelve null", async () => {
    expect(await getTelegramThreadId(undefined, "1")).toBeNull();
  });
});
