import type { KVNamespace } from "@cloudflare/workers-types";
import { z } from "zod";

/** Reply pendiente de entrega Telegram tras grafo OK (reintento de cola sin re-invoke). */
export function telegramPendingDeliveryKey(chatId: string): string {
  return `telegram:pending:${chatId}`;
}

const pendingTelegramDeliverySchema = z.object({
  threadId: z.string().min(1),
  reply: z.string(),
  text: z.string().min(1),
});

export type PendingTelegramDelivery = z.infer<typeof pendingTelegramDeliverySchema>;

export async function getPendingTelegramDelivery(
  kv: KVNamespace | undefined,
  chatId: string
): Promise<PendingTelegramDelivery | null> {
  if (!kv) return null;
  const raw = await kv.get(telegramPendingDeliveryKey(chatId));
  if (!raw) return null;
  try {
    const parsed = pendingTelegramDeliverySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function putPendingTelegramDelivery(
  kv: KVNamespace | undefined,
  chatId: string,
  data: PendingTelegramDelivery
): Promise<void> {
  if (!kv) return;
  await kv.put(telegramPendingDeliveryKey(chatId), JSON.stringify(data));
}

export async function clearPendingTelegramDelivery(
  kv: KVNamespace | undefined,
  chatId: string
): Promise<void> {
  if (!kv) return;
  await kv.delete(telegramPendingDeliveryKey(chatId));
}
