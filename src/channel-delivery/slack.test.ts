import { describe, expect, it, vi } from "vitest";
import { sendSlackMessage } from "./slack.js";

describe("sendSlackMessage", () => {
  it("envía chat.postMessage con Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendSlackMessage({ SLACK_BOT_TOKEN: "xoxb-test" }, "C123", "Hola agente");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer xoxb-test",
    });
    expect(JSON.parse(String(init.body))).toEqual({ channel: "C123", text: "Hola agente" });
  });

  it("lanza si la API devuelve ok:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
          status: 200,
        })
      )
    );

    await expect(sendSlackMessage({ SLACK_BOT_TOKEN: "t" }, "C1", "x")).rejects.toThrow(
      /channel_not_found/
    );
  });

  it("lanza sin token", async () => {
    await expect(sendSlackMessage({}, "C1", "x")).rejects.toThrow(/SLACK_BOT_TOKEN/);
  });
});
