import type { KVNamespace } from "@cloudflare/workers-types";
import { z } from "zod";

/** TTL por defecto para replies pendientes (24 h). */
export const PENDING_DELIVERY_TTL_SECONDS = 86_400;

/** Reply pendiente de entrega Telegram tras grafo OK (reintento de cola sin re-invoke). */
export function telegramPendingDeliveryKey(chatId: string, messageId: string): string {
  return `telegram:pending:${chatId}:${messageId}`;
}

const pendingTelegramDeliverySchema = z.object({
  threadId: z.string().min(1),
  reply: z.string(),
  text: z.string().min(1),
});

export type PendingTelegramDelivery = z.infer<typeof pendingTelegramDeliverySchema>;

export async function getPendingTelegramDelivery(
  kv: KVNamespace | undefined,
  chatId: string,
  messageId: string
): Promise<PendingTelegramDelivery | null> {
  if (!kv) return null;
  const raw = await kv.get(telegramPendingDeliveryKey(chatId, messageId));
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
  messageId: string,
  data: PendingTelegramDelivery
): Promise<void> {
  if (!kv) return;
  await kv.put(telegramPendingDeliveryKey(chatId, messageId), JSON.stringify(data), {
    expirationTtl: PENDING_DELIVERY_TTL_SECONDS,
  });
}

export async function clearPendingTelegramDelivery(
  kv: KVNamespace | undefined,
  chatId: string,
  messageId: string
): Promise<void> {
  if (!kv) return;
  await kv.delete(telegramPendingDeliveryKey(chatId, messageId));
}

/** No debe bloquear ack ni reintentos si KV falla tras entrega o HITL. */
export async function clearPendingTelegramDeliveryBestEffort(
  kv: KVNamespace | undefined,
  chatId: string,
  messageId: string
): Promise<void> {
  try {
    await clearPendingTelegramDelivery(kv, chatId, messageId);
  } catch (err) {
    console.error("[queue] KV pending clear failed (continuing):", err);
  }
}
