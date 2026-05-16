import type { KVNamespace } from "@cloudflare/workers-types";
import { parseThreadId } from "./chat-queue-payload.js";

/** TTL renovable por actividad (90 días). */
export const THREAD_KV_TTL_SECONDS = 90 * 24 * 3600;

export function telegramChatThreadKey(chatId: string): string {
  return `telegram:chat:${chatId}`;
}

export async function getTelegramThreadId(
  kv: KVNamespace | undefined,
  chatId: string
): Promise<string | null> {
  if (!kv) return null;
  const raw = await kv.get(telegramChatThreadKey(chatId));
  return parseThreadId(raw ?? undefined);
}

export async function putTelegramThreadId(
  kv: KVNamespace | undefined,
  chatId: string,
  threadId: string
): Promise<void> {
  if (!kv) return;
  await kv.put(telegramChatThreadKey(chatId), threadId, {
    expirationTtl: THREAD_KV_TTL_SECONDS,
  });
}
