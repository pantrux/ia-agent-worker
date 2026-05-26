import { describe, expect, it } from "vitest";
import {
  HitlCallbackV2Schema,
  InboundMessageV2Schema,
  OutboundMessageV2Schema
} from "./index.js";

const inboundFixture = {
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
  user: {
    id: "telegram:67890",
    display_name: "Operador"
  },
  text: "Aprueba la eliminación del cliente 123",
  reply_token: "12345",
  reply_mode: "async" as const,
  capabilities: {
    text_max: 4096,
    supports_streaming: false,
    supports_hitl_card: true,
    supports_attachments: true,
    supports_bidirectional: true,
    supports_markdown: true,
    supports_threads: false
  },
  created_at: "2026-05-26T07:10:10.000Z"
};

describe("canonical v2 schemas", () => {
  it("validates a Telegram inbound fixture", () => {
    expect(InboundMessageV2Schema.parse(inboundFixture)).toEqual(inboundFixture);
  });

  it("validates an outbound text reply", () => {
    const outbound = {
      payload_version: "2" as const,
      message_id: "out_001",
      trace_id: "trace_tg_001",
      conversation_id: "telegram:12345",
      reply_token: "12345",
      text: "Listo, dejé la solicitud registrada."
    };
    expect(OutboundMessageV2Schema.parse(outbound)).toEqual(outbound);
  });

  it("validates a HITL callback fixture", () => {
    const callback = {
      payload_version: "2" as const,
      trace_id: "trace_tg_001",
      conversation_id: "telegram:12345",
      interrupt_id: "hitl_pending-delete-cust-001",
      callback_ref: "hitl.v2.signed.example",
      action: { id: "approve", kind: "approve" as const },
      idempotency_key: "telegram:callback:abc123",
      created_at: "2026-05-26T07:11:00.000Z"
    };
    expect(HitlCallbackV2Schema.parse(callback)).toEqual(callback);
  });

  it("rejects inbound payloads without payload_version 2", () => {
    expect(() =>
      InboundMessageV2Schema.parse({ ...inboundFixture, payload_version: "1" })
    ).toThrow();
  });
});
