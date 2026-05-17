import { Agent, type Connection, type ConnectionContext } from "agents";
import type { Env } from "../env.js";
import { parseThreadId } from "../chat-queue-payload.js";
import {
  parseWsClientMessage,
  serializeWsServerMessage,
  type WsServerMessage,
} from "../ws-protocol.js";
import { verifyWsTicket } from "../ws-ticket.js";
import { dispatchWebSessionWsMessage, type WebSessionAgentState } from "./web-session-ws-handler.js";

export type { WebSessionAgentState };

export class WebSessionAgent extends Agent<Env, WebSessionAgentState> {
  initialState: WebSessionAgentState = {
    threadId: "",
    userId: "anonymous",
  };

  /** Ignora envíos si el socket ya no está abierto (p. ej. cliente desconectado durante el grafo). */
  private safeSend(connection: Connection, msg: WsServerMessage): void {
    try {
      if (connection.readyState !== WebSocket.OPEN) return;
      connection.send(serializeWsServerMessage(msg));
    } catch (e) {
      console.warn("[WebSessionAgent] send skipped (connection closed):", e);
    }
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const url = new URL(ctx.request.url);
    const ticket = url.searchParams.get("ticket");
    const pathParts = url.pathname.split("/").filter(Boolean);
    const sessionIdFromPath = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");
    const payload = await verifyWsTicket(this.env.WS_TICKET_SECRET, ticket);
    if (!payload || payload.sid !== sessionIdFromPath) {
      this.safeSend(connection, {
        type: "error",
        code: "unauthorized",
        message: "Ticket inválido o expirado",
      });
      connection.close(4001, "Unauthorized");
      return;
    }

    const userId = payload.uid?.trim() || "anonymous";
    if (userId !== this.state.userId) {
      this.setState({ ...this.state, userId });
    }

    const threadId = parseThreadId(this.state.threadId);
    this.safeSend(connection, {
      type: "ready",
      session_id: this.name,
      thread_id: threadId,
    });
  }

  onClose(connection: Connection, code: number, reason: string, wasClean: boolean): void {
    console.warn("[WebSessionAgent] connection closed", {
      session_id: this.name,
      connection_id: connection.id,
      code,
      reason,
      wasClean,
    });
  }

  onError(connection: Connection, error: unknown): void {
    console.error("[WebSessionAgent] connection error", {
      session_id: this.name,
      connection_id: connection.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = parseWsClientMessage(raw);
    if (!parsed) {
      this.safeSend(connection, {
        type: "error",
        code: "invalid_message",
        message: "Mensaje WS no reconocido",
      });
      return;
    }

    await dispatchWebSessionWsMessage(
      {
        env: this.env,
        state: this.state,
        sessionId: this.name,
        send: (msg) => this.safeSend(connection, msg),
        setState: (state) => this.setState(state),
      },
      parsed
    );
  }
}
