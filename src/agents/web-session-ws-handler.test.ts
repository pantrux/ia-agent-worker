import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { dispatchWebSessionWsMessage } from "./web-session-ws-handler.js";
import type { WebSessionAgentState } from "./web-session-ws-handler.js";

const runChatMessageGraph = vi.fn();
const runChatResumeGraph = vi.fn();

vi.mock("../chat-invocation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chat-invocation.js")>();
  return {
    ...actual,
    runChatMessageGraph: (...args: unknown[]) => runChatMessageGraph(...args),
    runChatResumeGraph: (...args: unknown[]) => runChatResumeGraph(...args),
  };
});

const THREAD_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const SESSION_ID = "session-test-1";

function graphReply(text: string) {
  return {
    messages: [{ content: text }],
    industry: "retail",
    intent: "lookup_order",
    toolState: { ok: true },
  };
}

describe("dispatchWebSessionWsMessage (PAN-32)", () => {
  let state: WebSessionAgentState;
  const sent: unknown[] = [];
  const env = {} as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    state = { threadId: THREAD_ID, userId: "user-1" };
    sent.length = 0;
  });

  const deps = () => ({
    env,
    state,
    sessionId: SESSION_ID,
    send: (msg: unknown) => sent.push(msg),
    setState: (next: WebSessionAgentState) => {
      state = next;
    },
  });

  it("responde pong a ping", async () => {
    await dispatchWebSessionWsMessage(deps(), { type: "ping" });
    expect(sent).toEqual([{ type: "pong" }]);
    expect(runChatMessageGraph).not.toHaveBeenCalled();
    expect(runChatResumeGraph).not.toHaveBeenCalled();
  });

  it("chat: GraphInterrupt → hitl_pending", async () => {
    const interrupt = {
      kind: "tool_approval",
      tool: "delete_customer_record",
      args: { customer_id: "c1" },
    };
    runChatMessageGraph.mockRejectedValueOnce({ name: "GraphInterrupt", value: interrupt });

    await dispatchWebSessionWsMessage(deps(), { type: "chat", text: "Borra al cliente c1" });

    expect(runChatMessageGraph).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        text: "Borra al cliente c1",
        threadId: THREAD_ID,
        channel: "web",
        userId: "user-1",
        operation: "ws_chat",
        sessionId: SESSION_ID,
      })
    );
    expect(sent).toEqual([
      {
        type: "hitl_pending",
        thread_id: THREAD_ID,
        interrupt,
      },
    ]);
  });

  it("resume sin thread activo → error no_thread", async () => {
    state = { threadId: "", userId: "user-1" };
    await dispatchWebSessionWsMessage(deps(), { type: "resume", approved: true });
    expect(runChatResumeGraph).not.toHaveBeenCalled();
    expect(sent).toEqual([
      {
        type: "error",
        code: "no_thread",
        message: "No hay hilo activo para reanudar",
      },
    ]);
  });

  it("resume aprobado → reply (paridad POST /api/chat/resume)", async () => {
    runChatResumeGraph.mockResolvedValueOnce(graphReply("Cliente eliminado."));

    await dispatchWebSessionWsMessage(deps(), { type: "resume", approved: true });

    expect(runChatResumeGraph).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        threadId: THREAD_ID,
        channel: "web",
        userId: "user-1",
        approved: true,
        operation: "ws_resume",
        sessionId: SESSION_ID,
      })
    );
    expect(sent).toEqual([
      {
        type: "reply",
        text: "Cliente eliminado.",
        thread_id: THREAD_ID,
        industry: "retail",
        intent: "lookup_order",
        tool_state: { ok: true },
      },
    ]);
  });

  it("resume denegado: GraphInterrupt persistente → hitl_pending", async () => {
    const interrupt = { kind: "tool_approval", tool: "delete_customer_record", args: {} };
    runChatResumeGraph.mockRejectedValueOnce({ name: "GraphInterrupt", value: interrupt });

    await dispatchWebSessionWsMessage(deps(), { type: "resume", approved: false });

    expect(runChatResumeGraph).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ approved: false, operation: "ws_resume" })
    );
    expect(sent).toEqual([
      {
        type: "hitl_pending",
        thread_id: THREAD_ID,
        interrupt,
      },
    ]);
  });

  it("chat: error genérico del grafo → internal_error", async () => {
    runChatMessageGraph.mockRejectedValueOnce(new Error("DB timeout"));

    await dispatchWebSessionWsMessage(deps(), { type: "chat", text: "hola" });

    expect(sent).toEqual([
      {
        type: "error",
        code: "internal_error",
        message: "Error al ejecutar el grafo",
      },
    ]);
  });

  it("resume: error genérico del grafo → internal_error", async () => {
    runChatResumeGraph.mockRejectedValueOnce(new Error("DB timeout"));

    await dispatchWebSessionWsMessage(deps(), { type: "resume", approved: true });

    expect(sent).toEqual([
      {
        type: "error",
        code: "internal_error",
        message: "Error al reanudar el grafo",
      },
    ]);
  });

  it("chat asigna thread_id en estado si aún no existía", async () => {
    state = { threadId: "", userId: "anon" };
    runChatMessageGraph.mockImplementation(async (_env, params) => {
      expect(params.threadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      return graphReply("hola");
    });

    await dispatchWebSessionWsMessage(deps(), { type: "chat", text: "hola" });

    expect(state.threadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(sent[0]).toMatchObject({ type: "reply", text: "hola" });
  });
});
