import { OutboundMessageV2Schema, type InboundMessageV2, type OutboundMessageV2 } from "../canonical/index.js";
import type { ChatGraphInvokeResult } from "../chat-invocation.js";
import { extractLastAiReply } from "../chat-reply.js";
import { classifyChatGraphError } from "../chat-graph-error.js";
import { buildHitlCardFromInterrupt, isHitlApprovalPayload } from "./hitl-card.js";

export function createOutboundMessageId(prefix = "omni_out"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function buildOutboundFromGraphSuccess(
  inbound: Pick<InboundMessageV2, "trace_id" | "conversation_id" | "reply_token">,
  result: ChatGraphInvokeResult
): OutboundMessageV2 {
  const text = extractLastAiReply(result);
  if (!text.trim()) {
    const outbound: OutboundMessageV2 = {
      payload_version: "2",
      message_id: createOutboundMessageId("omni_out_err"),
      trace_id: inbound.trace_id,
      conversation_id: inbound.conversation_id,
      reply_token: inbound.reply_token,
      error: {
        code: "empty_reply",
        message: "Graph completed without assistant reply",
        retryable: false
      }
    };
    return OutboundMessageV2Schema.parse(outbound);
  }

  const outbound: OutboundMessageV2 = {
    payload_version: "2",
    message_id: createOutboundMessageId(),
    trace_id: inbound.trace_id,
    conversation_id: inbound.conversation_id,
    reply_token: inbound.reply_token,
    text
  };
  return OutboundMessageV2Schema.parse(outbound);
}

export function buildOutboundFromGraphInterrupt(
  inbound: Pick<InboundMessageV2, "trace_id" | "conversation_id" | "reply_token">,
  interruptValue: unknown,
  now?: Date
): OutboundMessageV2 {
  if (!isHitlApprovalPayload(interruptValue)) {
    throw new Error("Unsupported interrupt payload for OutboundMessageV2");
  }
  const outbound: OutboundMessageV2 = {
    payload_version: "2",
    message_id: createOutboundMessageId("omni_out_hitl"),
    trace_id: inbound.trace_id,
    conversation_id: inbound.conversation_id,
    reply_token: inbound.reply_token,
    hitl_card: buildHitlCardFromInterrupt(interruptValue, inbound.trace_id, now)
  };
  return OutboundMessageV2Schema.parse(outbound);
}

export function buildOutboundFromGraphError(
  inbound: Pick<InboundMessageV2, "trace_id" | "conversation_id" | "reply_token">,
  error: unknown,
  operation: "v2_run" | "v2_resume"
): OutboundMessageV2 {
  const classified = classifyChatGraphError(error, operation === "v2_run" ? "chat" : "resume");
  const outbound: OutboundMessageV2 = {
    payload_version: "2",
    message_id: createOutboundMessageId("omni_out_err"),
    trace_id: inbound.trace_id,
    conversation_id: inbound.conversation_id,
    reply_token: inbound.reply_token,
    error: {
      code: classified.code,
      message: classified.message,
      retryable: classified.code === "rate_limited"
    }
  };
  return OutboundMessageV2Schema.parse(outbound);
}
