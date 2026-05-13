import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { Env } from "./env.js";
import { buildGraph } from "./graph.js";

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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/ping" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "ia-agent-worker" }, 200, request, env);
    }

    if (path === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (path === "/api/chat/resume" && request.method === "POST") {
      return handleResume(request, env);
    }

    return jsonResponse({ error: "Not found" }, 404, request, env);
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

function configureLangSmithEnv(env: Env): void {
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  if (!proc?.env) return;
  if (env.LANGSMITH_API_KEY) proc.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
  if (env.LANGSMITH_TRACING) proc.env.LANGSMITH_TRACING = env.LANGSMITH_TRACING;
  if (env.LANGSMITH_PROJECT) proc.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
  if (env.LANGCHAIN_CALLBACKS_BACKGROUND) {
    proc.env.LANGCHAIN_CALLBACKS_BACKGROUND = env.LANGCHAIN_CALLBACKS_BACKGROUND;
  }
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, request, env);
  }

  if (!body.message?.trim()) {
    return jsonResponse({ error: "message is required" }, 400, request, env);
  }

  const threadId = body.thread_id || crypto.randomUUID();
  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const config = {
    configurable: { thread_id: threadId },
    metadata: { thread_id: threadId, operation: "chat", runtime: "cloudflare-worker" },
    tags: ["api:chat", "langsmith"],
  };

  try {
    const result = await graph.invoke(
      { messages: [new HumanMessage(body.message)] },
      config
    );

    const messages = result.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    const reply = lastMsg ? (typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content)) : "";

    return jsonResponse(
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
    );
  } catch (e: unknown) {
    const err = e as { name?: string; value?: unknown };
    if (err.name === "GraphInterrupt" || String(e).includes("GraphInterrupt")) {
      const interruptValue = err.value ?? null;
      return jsonResponse(
        {
          thread_id: threadId,
          status: "pending_approval",
          interrupt: interruptValue,
        },
        200,
        request,
        env
      );
    }
    console.error("Chat error:", e);
    return jsonResponse({ error: String(e) }, 500, request, env);
  }
}

async function handleResume(request: Request, env: Env): Promise<Response> {
  let body: ResumeRequest;
  try {
    body = (await request.json()) as ResumeRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, request, env);
  }

  if (!body.thread_id) {
    return jsonResponse({ error: "thread_id is required" }, 400, request, env);
  }

  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const config = {
    configurable: { thread_id: body.thread_id },
    metadata: { thread_id: body.thread_id, operation: "resume", runtime: "cloudflare-worker" },
    tags: ["api:resume", "langsmith"],
  };

  try {
    const result = await graph.invoke(
      new Command({ resume: { approved: body.approved ?? false } }),
      config
    );

    const messages = result.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    const reply = lastMsg ? (typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content)) : "";

    return jsonResponse(
      {
        thread_id: body.thread_id,
        reply,
        industry: result.industry,
        tool_state: result.toolState,
      },
      200,
      request,
      env
    );
  } catch (e: unknown) {
    console.error("Resume error:", e);
    return jsonResponse({ error: String(e) }, 500, request, env);
  }
}
