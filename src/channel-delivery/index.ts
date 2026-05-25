import type { Env } from "../env.js";
import type { ChatDelivery } from "../chat-queue-payload.js";
import { sendSlackMessage } from "./slack.js";
import { sendTelegramMessage } from "./telegram.js";

export async function deliverChannelReply(
  env: Env,
  delivery: ChatDelivery,
  reply: string
): Promise<void> {
  const trimmed = reply.trim();
  if (!trimmed) return;

  switch (delivery.kind) {
    case "telegram":
      await sendTelegramMessage(env, delivery.chat_id, trimmed);
      break;
    case "slack":
      await sendSlackMessage(env, delivery.channel_id, trimmed);
      break;
    default: {
      const _exhaustive: never = delivery;
      throw new Error(`Unknown delivery kind: ${String(_exhaustive)}`);
    }
  }
}
