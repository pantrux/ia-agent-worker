import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { Env } from "./env.js";
import { buildGraph } from "./graph.js";
import { logWorkerAccess } from "./access-log.js";

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
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
      });
      return res;
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/ping" && request.method === "GET") {
      const res = jsonResponse({ status: "ok", service: "ia-agent-worker" }, 200, request, env);
      logWorkerAccess(request, env, { operation: "ping", status: res.status, durationMs: Date.now() - t0 });
      return res;
    }

    if (path === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (path === "/api/chat/resume" && request.method === "POST") {
      return handleResume(request, env);
    }

    const res = jsonResponse({ error: "Not found" }, 404, request, env);
    logWorkerAccess(request, env, { operation: "not_found", status: res.status, durationMs: Date.now() - t0 });
    return res;
  },
} satisfies ExportedHandler<Env>;

interface ChatRequest {
  message: string;
  thread_id?: string;
}

interface ResumeRequest {
  thread_id: string;
  approved: boolean;
}

const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let langSmithEnvWarned = false;

function parseThreadId(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return THREAD_ID_RE.test(value) ? value : null;
}

function configureLangSmithEnv(env: Env): void {
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  if (!proc?.env) {
    if (!langSmithEnvWarned) {
      console.warn("[LangSmith] process.env no disponible; tracing desactivado.");
      langSmithEnvWarned = true;
    }
    return;
  }
  if (!env.LANGSMITH_API_KEY) return;
  proc.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
  if (env.LANGSMITH_TRACING) proc.env.LANGSMITH_TRACING = env.LANGSMITH_TRACING;
  if (env.LANGSMITH_PROJECT) proc.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
  if (env.LANGCHAIN_CALLBACKS_BACKGROUND) {
    proc.env.LANGCHAIN_CALLBACKS_BACKGROUND = env.LANGCHAIN_CALLBACKS_BACKGROUND;
  }
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const finish = (res: Response, threadId?: string, err?: string) => {
    logWorkerAccess(request, env, {
      operation: "chat",
      status: res.status,
      durationMs: Date.now() - t0,
      thread_id: threadId,
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
  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const deploymentTags = env.DEPLOYMENT_ENV ? [`env:${env.DEPLOYMENT_ENV}`] : [];
  const config = {
    configurable: { thread_id: threadId },
    metadata: {
      thread_id: threadId,
      operation: "chat",
      runtime: "cloudflare-worker",
      ...(env.DEPLOYMENT_ENV ? { deployment: env.DEPLOYMENT_ENV } : {}),
    },
    tags: ["api:chat", "langsmith", ...deploymentTags],
  };

  try {
    const result = await graph.invoke(
      { messages: [new HumanMessage(body.message)] },
      config
    );

    const messages = result.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    const reply = lastMsg ? (typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content)) : "";

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
    const err = e as { name?: string; value?: unknown };
    if (err.name === "GraphInterrupt" || String(e).includes("GraphInterrupt")) {
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
    return finish(jsonResponse({ error: String(e) }, 500, request, env), threadId, String(e));
  }
}

async function handleResume(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const finish = (res: Response, threadId?: string, err?: string) => {
    logWorkerAccess(request, env, {
      operation: "resume",
      status: res.status,
      durationMs: Date.now() - t0,
      thread_id: threadId,
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

  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const deploymentTags = env.DEPLOYMENT_ENV ? [`env:${env.DEPLOYMENT_ENV}`] : [];
  const config = {
    configurable: { thread_id: threadId },
    metadata: {
      thread_id: threadId,
      operation: "resume",
      runtime: "cloudflare-worker",
      ...(env.DEPLOYMENT_ENV ? { deployment: env.DEPLOYMENT_ENV } : {}),
    },
    tags: ["api:resume", "langsmith", ...deploymentTags],
  };

  try {
    const result = await graph.invoke(
      new Command({ resume: { approved: body.approved ?? false } }),
      config
    );

    const messages = result.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    const reply = lastMsg ? (typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content)) : "";

    return finish(
      jsonResponse(
        {
          thread_id: threadId,
          reply,
          industry: result.industry,
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
    return finish(jsonResponse({ error: String(e) }, 500, request, env), threadId, String(e));
  }
}
