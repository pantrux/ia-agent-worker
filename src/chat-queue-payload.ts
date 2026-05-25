import { z } from "zod";

/** UUID v4 RFC 4122: versión `4` en el tercer bloque y variante 8/9/a/b en el cuarto. */
export const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseThreadId(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return THREAD_ID_RE.test(value) ? value : null;
}

/** Entrega asíncrona al usuario (PAN-18). */
export const telegramDeliverySchema = z.object({
  kind: z.literal("telegram"),
  chat_id: z.string().trim().min(1).max(64),
  /** `update_id` del Update de Telegram (no `message.message_id`); clave KV de pending por mensaje. */
  update_id: z.string().trim().min(1).max(64),
});

export const slackDeliverySchema = z.object({
  kind: z.literal("slack"),
  /** Canal Slack (`event.channel`, p. ej. `C0123…`). */
  channel_id: z.string().trim().min(1).max(64),
  /** `event_id` del envelope `event_callback` (deduplicación / pending KV). */
  event_id: z.string().trim().min(1).max(128),
});

export const chatDeliverySchema = z.discriminatedUnion("kind", [
  telegramDeliverySchema,
  slackDeliverySchema,
]);

export type ChatDelivery = z.infer<typeof chatDeliverySchema>;

/** Contrato cola / `POST /api/agent/messages` (PAN-17 + PAN-18). */
export const normalizedChatPayloadSchema = z.object({
  channel: z.string().trim().min(1).max(64),
  user_id: z.string().trim().min(1).max(256),
  text: z.string().trim().min(1).max(32000),
  thread_hint: z.string().trim().min(1).max(128).optional(),
  delivery: chatDeliverySchema.optional(),
});

export type NormalizedChatPayload = z.infer<typeof normalizedChatPayloadSchema>;

export type ParsePayloadResult =
  | { ok: true; data: NormalizedChatPayload }
  | { ok: false; error: string; issues?: z.ZodIssue[] };

export function parseNormalizedChatPayload(body: unknown): ParsePayloadResult {
  const r = normalizedChatPayloadSchema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid payload",
      issues: r.error.issues,
    };
  }
  return { ok: true, data: r.data };
}

/** Si `thread_hint` es UUID v4 válido → thread del grafo; si no → nuevo hilo. */
export function resolveThreadIdFromHint(threadHint: string | undefined): string {
  const parsed = parseThreadId(threadHint);
  return parsed ?? crypto.randomUUID();
}

export type ResolveQueueThreadIdFn = (
  threadHint: string | undefined,
  lookupKvThread: () => Promise<string | null>
) => Promise<string>;

/** KV (Telegram) tiene prioridad sobre `thread_hint`; si no hay ninguno → UUID nuevo. */
export const resolveQueueThreadId: ResolveQueueThreadIdFn = async (threadHint, lookupKvThread) => {
  const fromKv = await lookupKvThread();
  if (fromKv) return fromKv;
  return resolveThreadIdFromHint(threadHint);
};

export type ChatLangSmithOperation =
  | "chat"
  | "resume"
  | "queue_chat"
  | "ws_chat"
  | "ws_resume";

export function buildChatLangSmithMetadata(params: {
  threadId: string;
  channel: string;
  userId: string;
  operation: ChatLangSmithOperation;
  deploymentEnv?: string;
  sessionId?: string;
}): Record<string, string> {
  const meta: Record<string, string> = {
    thread_id: params.threadId,
    channel: params.channel,
    user_id: params.userId,
    operation: params.operation,
    runtime: "cloudflare-worker",
  };
  if (params.deploymentEnv) meta.deployment = params.deploymentEnv;
  if (params.sessionId) meta.session_id = params.sessionId;
  return meta;
}

export function buildChatLangSmithTags(
  deploymentTags: string[],
  channel: string
): string[] {
  return [`channel:${channel}`, "langsmith", ...deploymentTags];
}
