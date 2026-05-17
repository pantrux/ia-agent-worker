import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { Env } from "./env.js";
import { buildGraph } from "./graph.js";
import type { ChatLangSmithOperation } from "./chat-queue-payload.js";
import { buildChatLangSmithMetadata, buildChatLangSmithTags } from "./chat-queue-payload.js";
import {
  findUnresolvedCriticalToolApproval,
  synthesizeHitlForDeleteIntent,
} from "./hitl-pending.js";

let langSmithEnvWarned = false;

export function configureLangSmithEnv(env: Env): void {
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

export function isGraphInterruptError(e: unknown): boolean {
  const err = e as { name?: string };
  if (err?.name === "GraphInterrupt") return true;
  return String(e).includes("GraphInterrupt");
}

/**
 * LangGraph.js: `interrupt()` en un nodo pausa el grafo y expone el payload en
 * `result.__interrupt__` (no siempre lanza). Sin esta comprobación, HTTP/WS devuelven
 * `reply` vacío en lugar de `pending_approval` / `hitl_pending`.
 */
export function hasGraphInterrupt(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const interrupts = (result as { __interrupt__?: unknown }).__interrupt__;
  return Array.isArray(interrupts) && interrupts.length > 0;
}

export function extractGraphInterruptValue(result: unknown): unknown | undefined {
  if (!hasGraphInterrupt(result)) return undefined;
  const interrupts = (result as { __interrupt__: unknown[] }).__interrupt__;
  const last = interrupts[interrupts.length - 1];
  if (last && typeof last === "object" && "value" in last) {
    return (last as { value: unknown }).value;
  }
  return last;
}

function throwGraphInterruptValue(value: unknown): void {
  const err = new Error("GraphInterrupt") as Error & { name: string; value: unknown };
  err.name = "GraphInterrupt";
  err.value = value;
  throw err;
}

export function throwIfGraphInterrupted(
  result: unknown,
  opts?: { userText?: string }
): void {
  if (hasGraphInterrupt(result)) {
    throwGraphInterruptValue(extractGraphInterruptValue(result));
    return;
  }
  const pending =
    findUnresolvedCriticalToolApproval(result) ??
    (opts?.userText ? synthesizeHitlForDeleteIntent(result, opts.userText) : undefined);
  if (pending !== undefined) throwGraphInterruptValue(pending);
}

export type ChatGraphInvokeResult = Awaited<ReturnType<ReturnType<typeof buildGraph>["invoke"]>>;

/**
 * Invoca el grafo con un único mensaje humano (HTTP síncrono o consumer de cola).
 */
function buildGraphInvokeConfig(
  env: Env,
  params: {
    threadId: string;
    channel: string;
    userId: string;
    operation: ChatLangSmithOperation;
    sessionId?: string;
  }
) {
  const deploymentTags = env.DEPLOYMENT_ENV ? [`env:${env.DEPLOYMENT_ENV}`] : [];
  return {
    configurable: { thread_id: params.threadId },
    metadata: buildChatLangSmithMetadata({
      threadId: params.threadId,
      channel: params.channel,
      userId: params.userId,
      operation: params.operation,
      deploymentEnv: env.DEPLOYMENT_ENV,
      sessionId: params.sessionId,
    }),
    tags: buildChatLangSmithTags(deploymentTags, params.channel),
  };
}

export async function runChatMessageGraph(
  env: Env,
  params: {
    text: string;
    threadId: string;
    channel: string;
    userId: string;
    operation: ChatLangSmithOperation;
    sessionId?: string;
  }
): Promise<ChatGraphInvokeResult> {
  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const config = buildGraphInvokeConfig(env, params);
  const result = await graph.invoke({ messages: [new HumanMessage(params.text)] }, config);
  throwIfGraphInterrupted(result, { userText: params.text });
  return result;
}

export async function runChatResumeGraph(
  env: Env,
  params: {
    threadId: string;
    channel: string;
    userId: string;
    approved: boolean;
    operation: ChatLangSmithOperation;
    sessionId?: string;
  }
): Promise<ChatGraphInvokeResult> {
  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const config = buildGraphInvokeConfig(env, params);
  const result = await graph.invoke(new Command({ resume: { approved: params.approved } }), config);
  throwIfGraphInterrupted(result);
  return result;
}
