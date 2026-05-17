import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Env } from "./env.js";
import type { ChatWsTokenDeltaHandler } from "./chat-ws-stream.js";
import { wsStreamPauseMs } from "./ws-stream-pace.js";
import { getCopilotToken } from "./copilot-token.js";
import { resolveAiGatewayLlmConfig } from "./ai-gateway.js";
import {
  DEFAULT_COPILOT_MODEL,
  githubCopilotInferenceDefaultHeaders,
  normalizeModelIdForGithubModelsInference,
  rewriteGithubModelsBaseForOrg,
} from "./llm-client.js";

type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

type ResponsesInput =
  | { role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type ResponsesTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: JsonSchema;
};

function isResponsesModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return /^gpt-5/.test(m) || /^o\d/.test(m);
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return String(content ?? "").trim();
}

function parseToolArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function unwrapZod(schema: unknown): { schema: unknown; optional: boolean } {
  const def = (schema as { _def?: { typeName?: string; innerType?: unknown; description?: string } } | null)?._def;
  if (def?.typeName === "ZodOptional" || def?.typeName === "ZodNullable") {
    const inner = unwrapZod(def.innerType);
    return { schema: inner.schema, optional: true };
  }
  return { schema, optional: false };
}

function zodToJsonSchema(schema: unknown): JsonSchema {
  const unwrapped = unwrapZod(schema).schema as {
    _def?: {
      typeName?: string;
      description?: string;
      shape?: (() => Record<string, unknown>) | Record<string, unknown>;
    };
    description?: string;
  };
  const def = unwrapped?._def;
  const description = unwrapped?.description ?? def?.description;

  if (def?.typeName === "ZodObject") {
    const shape = typeof def.shape === "function" ? def.shape() : def.shape ?? {};
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const { optional } = unwrapZod(value);
      properties[key] = zodToJsonSchema(value);
      if (!optional) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false, ...(description ? { description } : {}) };
  }

  if (def?.typeName === "ZodNumber") return { type: "number", ...(description ? { description } : {}) };
  if (def?.typeName === "ZodBoolean") return { type: "boolean", ...(description ? { description } : {}) };
  if (def?.typeName === "ZodArray") return { type: "array", ...(description ? { description } : {}) };
  return { type: "string", ...(description ? { description } : {}) };
}

function toResponsesTools(tools: StructuredToolInterface[]): ResponsesTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.schema),
  }));
}

function toResponsesInput(messages: BaseMessage[]): ResponsesInput[] {
  const input: ResponsesInput[] = [];
  for (const message of messages) {
    const type = message._getType();
    if (type === "tool") {
      const toolMessage = message as BaseMessage & { tool_call_id?: string };
      input.push({
        type: "function_call_output",
        call_id: toolMessage.tool_call_id ?? "call",
        output: textContent(message.content),
      });
      continue;
    }
    if (type === "ai") {
      const aiMessage = message as AIMessage;
      if (textContent(aiMessage.content)) {
        input.push({ role: "assistant", content: textContent(aiMessage.content) });
      }
      for (const call of aiMessage.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id ?? "call",
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        });
      }
      continue;
    }
    input.push({
      role: type === "system" ? "system" : "user",
      content: textContent(message.content),
    });
  }
  return input;
}

function outputToAIMessage(payload: Record<string, unknown>): AIMessage {
  const outputText = typeof payload.output_text === "string" ? payload.output_text : "";
  const output = Array.isArray(payload.output) ? payload.output : [];
  const toolCalls = [];
  const textParts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (entry.type === "function_call") {
      const name = typeof entry.name === "string" ? entry.name : "";
      if (!name) continue;
      toolCalls.push({
        id: typeof entry.call_id === "string" ? entry.call_id : typeof entry.id === "string" ? entry.id : "call",
        name,
        args: parseToolArgs(entry.arguments),
      });
      continue;
    }
    if (entry.type === "message" && Array.isArray(entry.content)) {
      for (const part of entry.content) {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
  }

  return new AIMessage({
    content: outputText || textParts.join("").trim(),
    tool_calls: toolCalls,
  });
}

const RESPONSES_DELTA_EVENT_TYPES = new Set([
  "response.output_text.delta",
  "response.text.delta",
]);

function extractResponsesStreamDelta(payload: Record<string, unknown>, eventType: string): string {
  if (RESPONSES_DELTA_EVENT_TYPES.has(eventType) || RESPONSES_DELTA_EVENT_TYPES.has(String(payload.type ?? ""))) {
    const delta = payload.delta;
    if (typeof delta === "string") return delta;
    if (delta && typeof delta === "object" && "text" in delta && typeof delta.text === "string") {
      return delta.text;
    }
  }
  return "";
}

/** Emite texto en trozos y cede el event loop para que el WS y el cliente pinten (gateway sin deltas SSE). */
export async function emitStreamedTextDeltas(
  text: string,
  onDelta: ChatWsTokenDeltaHandler,
  chunkSize = 24,
  pauseMs = 20
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  for (let i = 0; i < trimmed.length; i += chunkSize) {
    await onDelta(trimmed.slice(i, i + chunkSize));
    await wsStreamPauseMs(pauseMs);
  }
}

async function parseResponsesSseChunk(
  block: string,
  onDelta?: ChatWsTokenDeltaHandler
): Promise<Record<string, unknown> | null> {
  const lines = block.split("\n");
  const dataLines: string[] = [];
  let eventType = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  const dataLine = dataLines.join("\n");
  if (!dataLine || dataLine === "[DONE]") return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = typeof payload.type === "string" ? payload.type : eventType;
  const delta = extractResponsesStreamDelta(payload, type);
  if (delta && onDelta) await onDelta(delta);
  return payload;
}

async function readResponsesSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: ChatWsTokenDeltaHandler
): Promise<Record<string, unknown> | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: Record<string, unknown> | null = null;
  let deltaCount = 0;
  const trackDelta = onDelta
    ? async (delta: string) => {
        if (!delta) return;
        deltaCount += 1;
        await onDelta(delta);
      }
    : undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const payload = await parseResponsesSseChunk(part, trackDelta);
        if (!payload) continue;
        if (payload.type === "response.completed" && payload.response && typeof payload.response === "object") {
          completed = payload.response as Record<string, unknown>;
        }
      }
    }

    if (buffer.trim()) {
      const payload = await parseResponsesSseChunk(buffer, trackDelta);
      if (payload?.type === "response.completed" && payload.response && typeof payload.response === "object") {
        completed = payload.response as Record<string, unknown>;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (completed && trackDelta && deltaCount === 0) {
    const fallbackText = textContent(outputToAIMessage(completed).content);
    await emitStreamedTextDeltas(fallbackText, trackDelta);
  }

  return completed;
}

export async function invokeResponsesIfRequired(
  env: Env,
  messages: BaseMessage[],
  tools: StructuredToolInterface[] = [],
  model?: string,
  onTokenDelta?: ChatWsTokenDeltaHandler
): Promise<AIMessage | null> {
  const upstreamRaw = await getCopilotToken(env.COPILOT_GITHUB_TOKEN, env.OPENAI_API_BASE);
  const upstream = {
    ...upstreamRaw,
    baseUrl: rewriteGithubModelsBaseForOrg(upstreamRaw.baseUrl, env.GITHUB_MODELS_ORG),
  };
  const rawModel = model ?? env.COPILOT_MODEL ?? DEFAULT_COPILOT_MODEL;
  const normalizedModel = normalizeModelIdForGithubModelsInference(upstream.baseUrl, rawModel);
  const cfg = resolveAiGatewayLlmConfig(env, upstream, normalizedModel);

  if (!cfg.baseUrl.includes("gateway.ai.cloudflare.com") || !isResponsesModel(cfg.model)) {
    return null;
  }

  const upstreamIsCopilot = upstream.baseUrl.toLowerCase().includes("githubcopilot.com");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    ...(upstreamIsCopilot ? githubCopilotInferenceDefaultHeaders() : {}),
    ...(cfg.defaultHeaders ?? {}),
    "content-type": "application/json",
  };
  const body: Record<string, unknown> = {
    model: cfg.model,
    input: toResponsesInput(messages),
    stream: Boolean(onTokenDelta),
  };
  if (tools.length) {
    body.tools = toResponsesTools(tools);
  }

  const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/v1/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Copilot Responses API failed (${response.status} ${response.statusText}): ${text.slice(0, 500)}`);
  }

  if (onTokenDelta) {
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (response.body && contentType.includes("text/event-stream")) {
      const completed = await readResponsesSseStream(response.body, onTokenDelta);
      if (completed) return outputToAIMessage(completed);
      throw new Error("Copilot Responses API stream ended without response.completed");
    }
    const raw = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`Copilot Responses API returned non-JSON (${response.status}): ${raw.slice(0, 500)}`);
    }
    const completed =
      payload.type === "response.completed" && payload.response && typeof payload.response === "object"
        ? (payload.response as Record<string, unknown>)
        : payload;
    const message = outputToAIMessage(completed);
    await emitStreamedTextDeltas(textContent(message.content), onTokenDelta);
    return message;
  }

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Copilot Responses API returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  return outputToAIMessage(payload);
}
