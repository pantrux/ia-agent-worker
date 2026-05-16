import { describe, expect, it, vi, afterEach } from "vitest";
import { sendTelegramMessage } from "./telegram.js";

describe("sendTelegramMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("llama Bot API sendMessage y valida body.ok", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "test-token" }, "98765", "Hola agente");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "98765", text: "Hola agente" });
  });

  it("falla si body.ok es false aunque HTTP sea 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, description: "blocked" }), { status: 200 })
        )
      )
    );

    await expect(
      sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "t" }, "1", "x")
    ).rejects.toThrow(/blocked/);
  });

  it("incluye cuerpo no-JSON en error HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("gateway timeout", { status: 502 })))
    );

    await expect(
      sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "t" }, "1", "x")
    ).rejects.toThrow(/502 gateway timeout/);
  });

  it("incluye cuerpo no-JSON cuando HTTP es 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not json", { status: 200 })))
    );

    await expect(
      sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "t" }, "1", "x")
    ).rejects.toThrow(/200 not json/);
  });

  it("falla sin token", async () => {
    await expect(sendTelegramMessage({}, "1", "x")).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});
