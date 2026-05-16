import { describe, expect, it, vi, afterEach } from "vitest";
import { sendTelegramMessage } from "./telegram.js";

describe("sendTelegramMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("llama Bot API sendMessage", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "test-token" }, "98765", "Hola agente");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "98765", text: "Hola agente" });
  });

  it("falla sin token", async () => {
    await expect(sendTelegramMessage({}, "1", "x")).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});
