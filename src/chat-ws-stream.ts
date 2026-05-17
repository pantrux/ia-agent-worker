import type { RunnableConfig } from "@langchain/core/runnables";

/** Clave en `config.configurable` para emitir deltas de texto hacia el cliente WS (PAN-33). */
export const CHAT_WS_TOKEN_DELTA_KEY = "chat_ws_token_delta";

export type ChatWsTokenDeltaHandler = (delta: string) => void;

export function readChatWsTokenDeltaHandler(config?: RunnableConfig): ChatWsTokenDeltaHandler | undefined {
  const cb = config?.configurable?.[CHAT_WS_TOKEN_DELTA_KEY];
  return typeof cb === "function" ? (cb as ChatWsTokenDeltaHandler) : undefined;
}

export function textDeltaFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}
