import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { handleAgentV2Resume, handleAgentV2Run } from "./index.js";

const runChatMessageGraph = vi.fn();
const runChatResumeGraph = vi.fn();

vi.mock("../chat-invocation.js", () => ({
  isGraphInterruptError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "GraphInterrupt",
  runChatMessageGraph: (...args: unknown[]) => runChatMessageGraph(...args),
  runChatResumeGraph: (...args: unknown[]) => runChatResumeGraph(...args)
}));

const env = {} as Env;

const inbound = {
  payload_version: "2" as const,
  message_id: "msg_tg_001",
  idempotency_key: "telegram:update-1001",
  trace_id: "trace_tg_001",
  channel: "telegram" as const,
  conversation_id: "telegram:12345",
  external_conversation_ref: {
    provider: "telegram" as const,
    chat_id: "12345"
  },
  user: { id: "telegram:67890" },
  text: "Elimina el cliente cust-001",
  reply_token: "12345",
  reply_mode: "async" as const,
  capabilities: {
    text_max: 4096,
    supports_streaming: false,
    supports_hitl_card: true,
    supports_attachments: true,
    supports_bidirectional: true
  },
  created_at: "2026-05-26T07:10:10.000Z"
};

describe("handleAgentV2Run", () => {
  beforeEach(() => {
    runChatMessageGraph.mockReset();
    runChatResumeGraph.mockReset();
  });

  it("returns 400 for invalid payloads", async () => {
    const response = await handleAgentV2Run(
      new Request("https://worker.test/v2/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload_version: "2" })
      }),
      env
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_payload" }
    });
  });

  it("returns 501 for reply_mode stream", async () => {
    const response = await handleAgentV2Run(
      new Request("https://worker.test/v2/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...inbound, reply_mode: "stream" })
      }),
      env
    );
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "reply_mode_not_supported" }
    });
  });

  it("returns OutboundMessageV2 text on graph success", async () => {
    runChatMessageGraph.mockResolvedValueOnce({
      messages: [{ content: "Listo, quedó registrado." }]
    });
    const response = await handleAgentV2Run(
      new Request("https://worker.test/v2/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inbound)
      }),
      env
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; outbound: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.outbound).toMatchObject({
      payload_version: "2",
      trace_id: inbound.trace_id,
      conversation_id: inbound.conversation_id,
      reply_token: inbound.reply_token,
      text: "Listo, quedó registrado."
    });
    expect(runChatMessageGraph).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        text: inbound.text,
        threadId: inbound.conversation_id,
        channel: inbound.channel,
        userId: inbound.user.id,
        operation: "v2_run"
      })
    );
  });

  it("returns OutboundMessageV2 hitl_card on graph interrupt", async () => {
    runChatMessageGraph.mockRejectedValueOnce({
      name: "GraphInterrupt",
      value: {
        kind: "tool_approval",
        tool: "delete_customer_record",
        args: { customer_id: "cust-001" },
        tool_call_id: "call_delete_001"
      }
    });
    const response = await handleAgentV2Run(
      new Request("https://worker.test/v2/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inbound)
      }),
      env
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { outbound: { hitl_card: Record<string, unknown> } };
    expect(body.outbound.hitl_card).toMatchObject({
      interrupt_id: "hitl_call_delete_001",
      callback_ref: "unsigned:trace_tg_001:hitl_call_delete_001"
    });
  });
});

describe("handleAgentV2Resume", () => {
  beforeEach(() => {
    runChatMessageGraph.mockReset();
    runChatResumeGraph.mockReset();
  });

  const callback = {
    payload_version: "2" as const,
    trace_id: "trace_tg_001",
    conversation_id: "telegram:12345",
    interrupt_id: "hitl_call_delete_001",
    callback_ref: "hitl.v2.signed.example",
    action: { id: "approve", kind: "approve" as const },
    idempotency_key: "telegram:callback:abc123",
    created_at: "2026-05-26T07:11:00.000Z"
  };

  it("returns 400 for custom callback actions", async () => {
    const response = await handleAgentV2Resume(
      new Request("https://worker.test/v2/agent/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...callback,
          action: { id: "later", kind: "custom" }
        })
      }),
      env
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "unsupported_action" }
    });
  });

  it("returns OutboundMessageV2 text after resume", async () => {
    runChatResumeGraph.mockResolvedValueOnce({
      messages: [{ content: "Cliente eliminado." }]
    });
    const response = await handleAgentV2Resume(
      new Request("https://worker.test/v2/agent/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(callback)
      }),
      env
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { outbound: Record<string, unknown> };
    expect(body.outbound).toMatchObject({
      payload_version: "2",
      trace_id: callback.trace_id,
      conversation_id: callback.conversation_id,
      text: "Cliente eliminado."
    });
    expect(runChatResumeGraph).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        threadId: callback.conversation_id,
        channel: "telegram",
        approved: true,
        operation: "v2_resume"
      })
    );
  });
});
