import { z } from "zod";

export const ChannelSchema = z.enum(["web", "telegram", "slack", "teams", "gchat"]);
export const ReplyModeSchema = z.enum(["sync", "async", "stream"]);

export const ExternalConversationRefSchema = z
  .object({
    provider: ChannelSchema,
    chat_id: z.string().min(1).optional(),
    channel_id: z.string().min(1).optional(),
    thread_ts: z.string().min(1).optional(),
    team_id: z.string().min(1).optional(),
    activity_id: z.string().min(1).optional(),
    conversation_id: z.string().min(1).optional(),
    service_url: z.string().url().optional(),
    space: z.string().min(1).optional(),
    thread: z.string().min(1).optional(),
    raw_ref: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const CanonicalUserSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().min(1).optional(),
    external_user_ref: z.string().min(1).optional()
  })
  .strict();

export const CanonicalAttachmentSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["image", "file", "audio", "video", "unknown"]),
    mime_type: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    url: z.string().url().optional(),
    provider_ref: z.string().min(1).optional()
  })
  .strict();

export const ChannelCapabilitiesSchema = z
  .object({
    text_max: z.number().int().positive(),
    supports_streaming: z.boolean(),
    supports_hitl_card: z.boolean(),
    supports_attachments: z.boolean(),
    supports_bidirectional: z.boolean(),
    supports_markdown: z.boolean().optional(),
    supports_threads: z.boolean().optional()
  })
  .strict();

export const HitlActionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["approve", "deny", "custom"]),
    label: z.string().min(1),
    destructive: z.boolean().optional()
  })
  .strict();

export const HitlCardSchema = z
  .object({
    interrupt_id: z.string().min(1),
    callback_ref: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    actions: z.array(HitlActionSchema).min(1),
    expires_at: z.string().datetime()
  })
  .strict();

export const ProviderMessageRefSchema = z
  .object({
    provider: ChannelSchema,
    message_id: z.string().min(1).optional(),
    thread_id: z.string().min(1).optional(),
    raw: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const CanonicalErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const InboundMessageV2Schema = z
  .object({
    payload_version: z.literal("2"),
    message_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    trace_id: z.string().min(1),
    channel: ChannelSchema,
    conversation_id: z.string().min(1),
    external_conversation_ref: ExternalConversationRefSchema,
    account_id: z.string().min(1).optional(),
    user: CanonicalUserSchema,
    text: z.string().min(1),
    attachments: z.array(CanonicalAttachmentSchema).optional(),
    reply_token: z.string().min(1),
    reply_mode: ReplyModeSchema,
    locale: z.string().min(2).optional(),
    capabilities: ChannelCapabilitiesSchema,
    created_at: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const OutboundMessageV2Schema = z
  .object({
    payload_version: z.literal("2"),
    message_id: z.string().min(1),
    trace_id: z.string().min(1),
    conversation_id: z.string().min(1),
    reply_token: z.string().min(1),
    text: z.string().min(1).optional(),
    hitl_card: HitlCardSchema.optional(),
    attachments: z.array(CanonicalAttachmentSchema).optional(),
    suggestions: z.array(z.string().min(1)).optional(),
    provider_message_ref: ProviderMessageRefSchema.optional(),
    error: CanonicalErrorSchema.optional()
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.text) ||
      Boolean(value.hitl_card) ||
      Boolean(value.error) ||
      (Array.isArray(value.attachments) && value.attachments.length > 0),
    { message: "OutboundMessageV2 requires text, hitl_card, attachments, or error" }
  );

export const HitlCallbackActionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["approve", "deny", "custom"])
  })
  .strict();

export const HitlCallbackV2Schema = z
  .object({
    payload_version: z.literal("2"),
    trace_id: z.string().min(1),
    conversation_id: z.string().min(1),
    interrupt_id: z.string().min(1),
    callback_ref: z.string().min(1),
    action: HitlCallbackActionSchema,
    idempotency_key: z.string().min(1),
    created_at: z.string().datetime()
  })
  .strict();

export type Channel = z.infer<typeof ChannelSchema>;
export type ReplyMode = z.infer<typeof ReplyModeSchema>;
export type InboundMessageV2 = z.infer<typeof InboundMessageV2Schema>;
export type OutboundMessageV2 = z.infer<typeof OutboundMessageV2Schema>;
export type HitlCard = z.infer<typeof HitlCardSchema>;
export type HitlCallbackV2 = z.infer<typeof HitlCallbackV2Schema>;
