import { HumanMessage } from "@langchain/core/messages";
import type { Env } from "./env.js";
import { buildGraph } from "./graph.js";
import type { ChatLangSmithOperation } from "./chat-queue-payload.js";
import { buildChatLangSmithMetadata, buildChatLangSmithTags } from "./chat-queue-payload.js";

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

export type ChatGraphInvokeResult = Awaited<ReturnType<ReturnType<typeof buildGraph>["invoke"]>>;

/**
 * Invoca el grafo con un único mensaje humano (HTTP síncrono o consumer de cola).
 */
export async function runChatMessageGraph(
  env: Env,
  params: {
    text: string;
    threadId: string;
    channel: string;
    userId: string;
    operation: ChatLangSmithOperation;
  }
): Promise<ChatGraphInvokeResult> {
  configureLangSmithEnv(env);
  const graph = buildGraph(env);
  const deploymentTags = env.DEPLOYMENT_ENV ? [`env:${env.DEPLOYMENT_ENV}`] : [];
  const config = {
    configurable: { thread_id: params.threadId },
    metadata: buildChatLangSmithMetadata({
      threadId: params.threadId,
      channel: params.channel,
      userId: params.userId,
      operation: params.operation,
      deploymentEnv: env.DEPLOYMENT_ENV,
    }),
    tags: buildChatLangSmithTags(deploymentTags, params.channel),
  };

  return graph.invoke({ messages: [new HumanMessage(params.text)] }, config);
}
