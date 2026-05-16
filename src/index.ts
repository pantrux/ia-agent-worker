import { Command } from "@langchain/langgraph";
import type { ExportedHandler } from "@cloudflare/workers-types";
import type { Env } from "./env.js";
import { buildGraph } from "./graph.js";
import { logWorkerAccess } from "./access-log.js";
import {
  verifyBffApiAuth,
  parseTrustedAaasUserIdHeader,
  type BffAuthFailureReason,
} from "./bff-auth.js";
import {
  parseNormalizedChatPayload,
  parseThreadId,
  resolveQueueThreadId,
  buildChatLangSmithMetadata,
  buildChatLangSmithTags,
  type NormalizedChatPayload,
} from "./chat-queue-payload.js";
import {
  configureLangSmithEnv,
  isGraphInterruptError,
  runChatMessageGraph,
} from "./chat-invocation.js";
import { extractLastAiReply } from "./chat-reply.js";
import { deliverChannelReply } from "./channel-delivery/index.js";
import {
  clearPendingTelegramDeliveryBestEffort,
  getPendingTelegramDelivery,
  putPendingTelegramDelivery,
} from "./chat-pending-delivery.js";
import { getTelegramThreadId, putTelegramThreadId } from "./chat-thread-kv.js";

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const raw = (env.ALLOWED_ORIGINS ?? "").trim();
  const allowList = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  let allowOrigin = "";
  if (allowList.includes("*")) {
    allowOrigin = origin || "*";
  } else if (origin && allowList.includes(origin)) {
    allowOrigin = origin;
  } else if (allowList.length === 1) {
    allowOrigin = allowList[0]!;
  }

  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-AAAS-User-Id",
    "Access-Control-Max-Age": "86400",
  };
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
    h["Vary"] = "Origin";
  }
  return h;
}

function jsonResponse(data: unknown, status: number, request: Request, env: Env): Response {
  const headers = { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) };
  return new Response(JSON.stringify(data), { status, headers });
}

/** Cuerpo JSON para 500 en chat/resume; `detail`/`stack` solo si `EXPOSE_CHAT_ERROR` está activo (no usar en prod pública). */
function chatInternalErrorBody(env: Env, e: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { error: "Internal server error" };
  const expose =
    env.EXPOSE_CHAT_ERROR === "true" ||
    env.EXPOSE_CHAT_ERROR === "1" ||
    env.EXPOSE_CHAT_ERROR === "yes";
  if (expose) {
    const msg = e instanceof Error ? e.message : String(e);
    body.detail = msg.slice(0, 1200);
    if (e instanceof Error && e.stack) body.stack = e.stack.split("\n").slice(0, 12).join("\n");
  }
  return body;
}

function jsonBffUnauthorized(request: Request, env: Env, t0: number, reason: BffAuthFailureReason): Response {
  const res = jsonResponse({ error: "No autorizado" }, 401, request, env);
  res.headers.set("WWW-Authenticate", 'Bearer realm="bff"');
  logWorkerAccess(request, env, {
    operation: "bff_auth",
    status: res.status,
    durationMs: Date.now() - t0,
    requestTs: new Date(t0).toISOString(),
    error: reason,
  });
  return res;
}

interface ChatRequest {
  message: string;
  thread_id?: string;
}

interface ResumeRequest {
  thread_id: string;
  approved: boolean;
}

async function lookupKvThreadId(env: Env, data: NormalizedChatPayload): Promise<string | null> {
  if (data.delivery?.kind === "telegram") {
    return getTelegramThreadId(env.CHAT_THREAD_KV, data.delivery.chat_id);
  }
  return null;
}

/** Best-effort: KV antes del grafo/entrega para que reintentos de cola reutilicen el mismo hilo. */
async function persistThreadForChannel(
  env: Env,
  data: NormalizedChatPayload,
  threadId: string
): Promise<void> {
  if (data.delivery?.kind === "telegram") {
    await putTelegramThreadId(env.CHAT_THREAD_KV, data.delivery.chat_id, threadId);
  }
}

type QueueMessage = { ack(): void; retry(options?: { delaySeconds?: number }): void };

/**
 * Consumer de cola: grafo + entrega Telegram. Si la Bot API falla tras grafo OK,
 * guarda reply en KV y en reintento solo reenvía (sin duplicar invoke).
 */
async function processQueueChatMessage(
  env: Env,
  data: NormalizedChatPayload,
  msg: QueueMessage
): Promise<void> {
  const threadId = await resolveQueueThreadId(data.thread_hint, () => lookupKvThreadId(env, data));
  const { channel, user_id: userId, text } = data;
  const delivery = data.delivery;
  const telegram =
    delivery?.kind === "telegram"
      ? { chatId: delivery.chat_id, updateId: delivery.update_id }
      : undefined;

  if (delivery) {
    try {
      await persistThreadForChannel(env, data, threadId);
    } catch (kvErr) {
      console.error("[queue] KV thread persist failed (continuing):", kvErr);
    }
  }

  if (telegram && delivery) {
    const pending = await getPendingTelegramDelivery(
      env.CHAT_THREAD_KV,
      telegram.chatId,
      telegram.updateId
    );
    if (pending && pending.text === text) {
      try {
        await deliverChannelReply(env, delivery, pending.reply);
        await clearPendingTelegramDeliveryBestEffort(
          env.CHAT_THREAD_KV,
          telegram.chatId,
          telegram.updateId
        );
        msg.ack();
        return;
      } catch (deliveryErr) {
        console.error("[queue] Telegram delivery retry failed:", deliveryErr);
        msg.retry({ delaySeconds: 30 });
        return;
      }
    }
  }

  let result;
  try {
    result = await runChatMessageGraph(env, {
      text,
      threadId,
      channel,
      userId,
      operation: "queue_chat",
    });
  } catch (e: unknown) {
    if (isGraphInterruptError(e)) {
      console.warn("[queue] GraphInterrupt (HITL); ack. thread_id=", threadId);
      if (telegram) {
        await clearPendingTelegramDeliveryBestEffort(
          env.CHAT_THREAD_KV,
          telegram.chatId,
          telegram.updateId
        );
      }
      msg.ack();
      return;
    }
    if (telegram) {
      await clearPendingTelegramDeliveryBestEffort(
        env.CHAT_THREAD_KV,
        telegram.chatId,
        telegram.updateId
      );
    }
    console.error("[queue] error en invoke:", e);
    msg.retry({ delaySeconds: 30 });
    return;
  }

  if (!delivery) {
    msg.ack();
    return;
  }

  const reply = extractLastAiReply(result);
  if (telegram) {
    try {
      await putPendingTelegramDelivery(
        env.CHAT_THREAD_KV,
        telegram.chatId,
        telegram.updateId,
        { threadId, reply, text }
      );
    } catch (kvErr) {
      console.error("[queue] KV pending persist failed (continuing):", kvErr);
    }
  }

  try {
    await deliverChannelReply(env, delivery, reply);
  } catch (deliveryErr) {
    console.error(
      "[queue] Telegram delivery failed (pending en KV; reintento sin grafo):",
      deliveryErr
    );
    msg.retry({ delaySeconds: 30 });
    return;
  }

  if (telegram) {
    await clearPendingTelegramDeliveryBestEffort(
      env.CHAT_THREAD_KV,
      telegram.chatId,
      telegram.updateId
    );
  }
  msg.ack();
}

async function handleEnqueueAgentMessage(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const requestTs = new Date(t0).toISOString();
  const finish = (res: Response, err?: string) => {
    logWorkerAccess(request, env, {
      operation: "agent_messages_enqueue",
      status: res.status,
      durationMs: Date.now() - t0,
      requestTs,
      error: err,
    });
    return res;
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return finish(jsonResponse({ error: "Invalid JSON body" }, 400, request, env));
  }

  const parsed = parseNormalizedChatPayload(body);
  if (!parsed.ok) {
    return finish(jsonResponse({ error: parsed.error }, 400, request, env), "validation");
  }

  try {
    await env.CHAT_INGEST_QUEUE.send(parsed.data, { contentType: "json" });
  } catch (e) {
    console.error("Queue send error:", e);
    return finish(jsonResponse({ error: "Failed to enqueue message" }, 502, request, env), "queue_send");
  }

  return finish(
    jsonResponse({ accepted: true, channel: parsed.data.channel }, 202, request, env)
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const t0 = Date.now();

    if (request.method === "OPTIONS") {
      const res = new Response(null, { status: 204, headers: cors });
      logWorkerAccess(request, env, {
        operation: "cors_preflight",
        status: res.status,
        durationMs: Date.now() - t0,
        requestTs: new Date(t0).toISOString(),
      });
      return res;
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/ping" && request.method === "GET") {
      const res = jsonResponse({ status: "ok", service: "ia-agent-worker" }, 200, request, env);
      logWorkerAccess(request, env, {
        operation: "ping",
        status: res.status,
        durationMs: Date.now() - t0,
        requestTs: new Date(t0).toISOString(),
      });
      return res;
    }

    if (path === "/api/chat" && request.method === "POST") {
      const auth = verifyBffApiAuth(request, env);
      if (!auth.ok) return jsonBffUnauthorized(request, env, t0, auth.reason);
      return handleChat(request, env);
    }

    if (path === "/api/chat/resume" && request.method === "POST") {
      const auth = verifyBffApiAuth(request, env);
      if (!auth.ok) return jsonBffUnauthorized(request, env, t0, auth.reason);
      return handleResume(request, env);
    }

    if (path === "/api/agent/messages" && request.method === "POST") {
      const auth = verifyBffApiAuth(request, env);
      if (!auth.ok) return jsonBffUnauthorized(request, env, t0, auth.reason);
      return handleEnqueueAgentMessage(request, env);
    }

    const res = jsonResponse({ error: "Not found" }, 404, request, env);
    logWorkerAccess(request, env, {
      operation: "not_found",
      status: res.status,
      durationMs: Date.now() - t0,
      requestTs: new Date(t0).toISOString(),
    });
    return res;
  },

  async queue(batch, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const raw = msg.body as unknown;
        const parsed = parseNormalizedChatPayload(raw);
        if (!parsed.ok) {
          console.error("[queue] payload inválido (ack, sin reintento):", parsed.error);
          msg.ack();
          continue;
        }

        await processQueueChatMessage(env, parsed.data, msg);
      } catch (loopErr) {
        console.error("[queue] error inesperado por mensaje:", loopErr);
        msg.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Env>;

async function handleChat(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const requestTs = new Date(t0).toISOString();
  const aaasUserId = parseTrustedAaasUserIdHeader(request, env);
  const userId = aaasUserId ?? "anonymous";

  const finish = (res: Response, threadId?: string, err?: string) => {
    logWorkerAccess(request, env, {
      operation: "chat",
      status: res.status,
      durationMs: Date.now() - t0,
      requestTs,
      thread_id: threadId,
      aaas_user_id: aaasUserId ?? null,
      error: err,
    });
    return res;
  };

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return finish(jsonResponse({ error: "Invalid JSON body" }, 400, request, env));
  }

  if (!body.message?.trim()) {
    return finish(jsonResponse({ error: "message is required" }, 400, request, env));
  }

  const parsedThreadId = parseThreadId(body.thread_id);
  if (body.thread_id && !parsedThreadId) {
    return finish(jsonResponse({ error: "thread_id must be a valid UUID" }, 400, request, env));
  }
  const threadId = parsedThreadId ?? crypto.randomUUID();

  try {
    const result = await runChatMessageGraph(env, {
      text: body.message,
      threadId,
      channel: "web",
      userId,
      operation: "chat",
    });

    const reply = extractLastAiReply(result);

    return finish(
      jsonResponse(
        {
          thread_id: threadId,
          reply,
          industry: result.industry,
          intent: result.intent,
          tool_state: result.toolState,
        },
        200,
        request,
        env
      ),
      threadId
    );
  } catch (e: unknown) {
    if (isGraphInterruptError(e)) {
      const err = e as { value?: unknown };
      const interruptValue = err.value ?? null;
      return finish(
        jsonResponse(
          {
            thread_id: threadId,
            status: "pending_approval",
            interrupt: interruptValue,
          },
          200,
          request,
          env
        ),
        threadId
      );
    }
    console.error("Chat error:", e);
    const errCode = e instanceof Error ? e.name : "internal_error";
    return finish(jsonResponse(chatInternalErrorBody(env, e), 500, request, env), threadId, errCode);
  }
}

async function handleResume(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const requestTs = new Date(t0).toISOString();
  const aaasUserId = parseTrustedAaasUserIdHeader(request, env);
  const userId = aaasUserId ?? "anonymous";

  const finish = (res: Response, threadId?: string, err?: string) => {
    logWorkerAccess(request, env, {
      operation: "resume",
      status: res.status,
      durationMs: Date.now() - t0,
      requestTs,
      thread_id: threadId,
      aaas_user_id: aaasUserId ?? null,
      error: err,
    });
    return res;
  };

  let body: ResumeRequest;
  try {
    body = (await request.json()) as ResumeRequest;
  } catch {
    return finish(jsonResponse({ error: "Invalid JSON body" }, 400, request, env));
  }

  if (!body.thread_id) {
    return finish(jsonResponse({ error: "thread_id is required" }, 400, request, env));
  }
  const threadId = parseThreadId(body.thread_id);
  if (!threadId) {
    return finish(jsonResponse({ error: "thread_id must be a valid UUID" }, 400, request, env));
  }

  try {
    configureLangSmithEnv(env);
    const graph = buildGraph(env);
    const deploymentTags = env.DEPLOYMENT_ENV ? [`env:${env.DEPLOYMENT_ENV}`] : [];
    const channel = "web";
    const config = {
      configurable: { thread_id: threadId },
      metadata: buildChatLangSmithMetadata({
        threadId,
        channel,
        userId,
        operation: "resume",
        deploymentEnv: env.DEPLOYMENT_ENV,
      }),
      tags: buildChatLangSmithTags(deploymentTags, channel),
    };

    const result = await graph.invoke(
      new Command({ resume: { approved: body.approved ?? false } }),
      config
    );

    const reply = extractLastAiReply(result);

    return finish(
      jsonResponse(
        {
          thread_id: threadId,
          reply,
          industry: result.industry,
          intent: result.intent,
          tool_state: result.toolState,
        },
        200,
        request,
        env
      ),
      threadId
    );
  } catch (e: unknown) {
    console.error("Resume error:", e);
    const errCode = e instanceof Error ? e.name : "internal_error";
    return finish(jsonResponse(chatInternalErrorBody(env, e), 500, request, env), threadId, errCode);
  }
}
