import type { KVNamespace } from "@cloudflare/workers-types";
import { parseThreadId } from "./chat-queue-payload.js";

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
  await kv.put(telegramChatThreadKey(chatId), threadId);
}
