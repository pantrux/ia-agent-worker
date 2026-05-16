import { z } from "zod";

/** UUID v4 (misma regla que `POST /api/chat` para `thread_id`). */
export const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseThreadId(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return THREAD_ID_RE.test(value) ? value : null;
}

/** Contrato cola / `POST /api/agent/messages` (PAN-17). */
export const normalizedChatPayloadSchema = z.object({
  channel: z.string().trim().min(1).max(64),
  user_id: z.string().trim().min(1).max(256),
  text: z.string().trim().min(1).max(32000),
  thread_hint: z.string().trim().min(1).max(128).optional(),
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

export type ChatLangSmithOperation = "chat" | "resume" | "queue_chat";

export function buildChatLangSmithMetadata(params: {
  threadId: string;
  channel: string;
  userId: string;
  operation: ChatLangSmithOperation;
  deploymentEnv?: string;
}): Record<string, string> {
  const meta: Record<string, string> = {
    thread_id: params.threadId,
    channel: params.channel,
    user_id: params.userId,
    operation: params.operation,
    runtime: "cloudflare-worker",
  };
  if (params.deploymentEnv) meta.deployment = params.deploymentEnv;
  return meta;
}

export function buildChatLangSmithTags(
  deploymentTags: string[],
  channel: string
): string[] {
  return [`channel:${channel}`, "langsmith", ...deploymentTags];
}
