import type { Env } from "./env.js";
import type { ChatDelivery, NormalizedChatPayload } from "./chat-queue-payload.js";
import {
  clearPendingSlackDeliveryBestEffort,
  clearPendingTelegramDeliveryBestEffort,
  getPendingSlackDelivery,
  getPendingTelegramDelivery,
  putPendingSlackDelivery,
  putPendingTelegramDelivery,
  type PendingTelegramDelivery,
} from "./chat-pending-delivery.js";
import {
  getSlackThreadId,
  getTelegramThreadId,
  putSlackThreadId,
  putTelegramThreadId,
} from "./chat-thread-kv.js";

export type QueueDeliveryCtx =
  | { kind: "telegram"; chatId: string; dedupeId: string }
  | { kind: "slack"; channelId: string; dedupeId: string };

export function resolveQueueDeliveryCtx(delivery: ChatDelivery): QueueDeliveryCtx {
  if (delivery.kind === "telegram") {
    return { kind: "telegram", chatId: delivery.chat_id, dedupeId: delivery.update_id };
  }
  return { kind: "slack", channelId: delivery.channel_id, dedupeId: delivery.event_id };
}

export async function lookupKvThreadIdForPayload(
  env: Env,
  data: NormalizedChatPayload
): Promise<string | null> {
  if (data.delivery?.kind === "telegram") {
    return getTelegramThreadId(env.CHAT_THREAD_KV, data.delivery.chat_id);
  }
  if (data.delivery?.kind === "slack") {
    return getSlackThreadId(env.CHAT_THREAD_KV, data.delivery.channel_id);
  }
  return null;
}

export async function persistThreadForPayload(
  env: Env,
  data: NormalizedChatPayload,
  threadId: string
): Promise<void> {
  if (data.delivery?.kind === "telegram") {
    await putTelegramThreadId(env.CHAT_THREAD_KV, data.delivery.chat_id, threadId);
    return;
  }
  if (data.delivery?.kind === "slack") {
    await putSlackThreadId(env.CHAT_THREAD_KV, data.delivery.channel_id, threadId);
  }
}

export async function getPendingDeliveryForCtx(
  env: Env,
  ctx: QueueDeliveryCtx
): Promise<PendingTelegramDelivery | null> {
  if (ctx.kind === "telegram") {
    return getPendingTelegramDelivery(env.CHAT_THREAD_KV, ctx.chatId, ctx.dedupeId);
  }
  return getPendingSlackDelivery(env.CHAT_THREAD_KV, ctx.channelId, ctx.dedupeId);
}

export async function putPendingDeliveryForCtx(
  env: Env,
  ctx: QueueDeliveryCtx,
  data: PendingTelegramDelivery
): Promise<void> {
  if (ctx.kind === "telegram") {
    await putPendingTelegramDelivery(env.CHAT_THREAD_KV, ctx.chatId, ctx.dedupeId, data);
    return;
  }
  await putPendingSlackDelivery(env.CHAT_THREAD_KV, ctx.channelId, ctx.dedupeId, data);
}

export async function clearPendingDeliveryForCtxBestEffort(
  env: Env,
  ctx: QueueDeliveryCtx
): Promise<void> {
  if (ctx.kind === "telegram") {
    await clearPendingTelegramDeliveryBestEffort(env.CHAT_THREAD_KV, ctx.chatId, ctx.dedupeId);
    return;
  }
  await clearPendingSlackDeliveryBestEffort(env.CHAT_THREAD_KV, ctx.channelId, ctx.dedupeId);
}
