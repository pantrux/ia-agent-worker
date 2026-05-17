import { Agent, type Connection, type ConnectionContext } from "agents";
import type { Env } from "../env.js";
import { extractLastAiReply } from "../chat-reply.js";
import {
  isGraphInterruptError,
  runChatMessageGraph,
  runChatResumeGraph,
} from "../chat-invocation.js";
import { parseThreadId } from "../chat-queue-payload.js";
import {
  parseWsClientMessage,
  serializeWsServerMessage,
  type WsServerMessage,
} from "../ws-protocol.js";
import { verifyWsTicket } from "../ws-ticket.js";

export interface WebSessionAgentState {
  threadId: string;
  userId: string;
}

export class WebSessionAgent extends Agent<Env, WebSessionAgentState> {
  initialState: WebSessionAgentState = {
    threadId: "",
    userId: "anonymous",
  };

  private send(connection: Connection, msg: WsServerMessage): void {
    connection.send(serializeWsServerMessage(msg));
  }

  private ensureThreadId(): string {
    const existing = parseThreadId(this.state.threadId);
    if (existing) return existing;
    const threadId = crypto.randomUUID();
    this.setState({ ...this.state, threadId });
    return threadId;
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const url = new URL(ctx.request.url);
    const ticket = url.searchParams.get("ticket");
    const payload = await verifyWsTicket(this.env.WS_TICKET_SECRET, ticket);
    if (!payload || payload.sid !== this.name) {
      this.send(connection, {
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
    this.send(connection, {
      type: "ready",
      session_id: this.name,
      thread_id: threadId,
    });
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = parseWsClientMessage(raw);
    if (!parsed) {
      this.send(connection, {
        type: "error",
        code: "invalid_message",
        message: "Mensaje WS no reconocido",
      });
      return;
    }

    if (parsed.type === "ping") {
      this.send(connection, { type: "pong" });
      return;
    }

    const sessionId = this.name;
    const channel = "web";
    const userId = this.state.userId || "anonymous";

    if (parsed.type === "resume") {
      const threadId = parseThreadId(this.state.threadId);
      if (!threadId) {
        this.send(connection, {
          type: "error",
          code: "no_thread",
          message: "No hay hilo activo para reanudar",
        });
        return;
      }
      try {
        const result = await runChatResumeGraph(this.env, {
          threadId,
          channel,
          userId,
          approved: parsed.approved,
          operation: "ws_resume",
          sessionId,
        });
        const reply = extractLastAiReply(result);
        this.send(connection, {
          type: "reply",
          text: reply,
          thread_id: threadId,
          industry: result.industry,
          intent: result.intent,
          tool_state: result.toolState,
        });
      } catch (e: unknown) {
        if (isGraphInterruptError(e)) {
          const err = e as { value?: unknown };
          this.send(connection, {
            type: "hitl_pending",
            thread_id: threadId,
            interrupt: err.value ?? null,
          });
          return;
        }
        console.error("[WebSessionAgent] resume error:", e);
        this.send(connection, {
          type: "error",
          code: "internal_error",
          message: "Error al reanudar el grafo",
        });
      }
      return;
    }

    const threadId = this.ensureThreadId();
    try {
      const result = await runChatMessageGraph(this.env, {
        text: parsed.text,
        threadId,
        channel,
        userId,
        operation: "ws_chat",
        sessionId,
      });
      const reply = extractLastAiReply(result);
      this.send(connection, {
        type: "reply",
        text: reply,
        thread_id: threadId,
        industry: result.industry,
        intent: result.intent,
        tool_state: result.toolState,
      });
    } catch (e: unknown) {
      if (isGraphInterruptError(e)) {
        const err = e as { value?: unknown };
        this.send(connection, {
          type: "hitl_pending",
          thread_id: threadId,
          interrupt: err.value ?? null,
        });
        return;
      }
      console.error("[WebSessionAgent] chat error:", e);
      this.send(connection, {
        type: "error",
        code: "internal_error",
        message: "Error al ejecutar el grafo",
      });
    }
  }
}
