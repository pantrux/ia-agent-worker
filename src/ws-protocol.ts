import { z } from "zod";

export const wsClientChatSchema = z.object({
  type: z.literal("chat"),
  text: z.string().trim().min(1).max(32000),
});

export const wsClientResumeSchema = z.object({
  type: z.literal("resume"),
  approved: z.boolean(),
});

export const wsClientPingSchema = z.object({
  type: z.literal("ping"),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  wsClientChatSchema,
  wsClientResumeSchema,
  wsClientPingSchema,
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export type WsServerReady = {
  type: "ready";
  session_id: string;
  thread_id: string | null;
};

export type WsServerReply = {
  type: "reply";
  text: string;
  thread_id: string;
  industry?: string;
  intent?: string;
  tool_state?: unknown;
};

export type WsServerHitlPending = {
  type: "hitl_pending";
  thread_id: string;
  interrupt: unknown;
};

export type WsServerPong = { type: "pong" };

export type WsServerError = {
  type: "error";
  code: string;
  message: string;
};

export type WsServerMessage =
  | WsServerReady
  | WsServerReply
  | WsServerHitlPending
  | WsServerPong
  | WsServerError;

export function parseWsClientMessage(raw: string): WsClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = wsClientMessageSchema.safeParse(json);
  return r.success ? r.data : null;
}

export function serializeWsServerMessage(msg: WsServerMessage): string {
  return JSON.stringify(msg);
}
