import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { GraphState, Industry } from "../state.js";
import type { Env } from "../env.js";
import { createChatOpenAI } from "../llm-client.js";

const RouteSchema = z.object({
  industry: z.enum(["retail", "finance", "health", "unknown"]).describe("Primary industry for this turn."),
  intent: z.string().describe("Short intent label, e.g. lookup_order, create_lead, delete_customer."),
});

const KEYWORD_RULES: [RegExp, Industry][] = [
  [/\b(retail|shop|store|sku|inventory)\b/i, "retail"],
  [/\b(finance|bank|loan|portfolio|trading|compliance)\b/i, "finance"],
  [/\b(health|clinic|patient|hipaa|phi|medical)\b/i, "health"],
];

const NAME_HINTS: [RegExp, Industry][] = [
  [/\bacme\b/i, "retail"],
  [/\bfinance\s*co\b/i, "finance"],
  [/\bclinic\s*plus\b/i, "health"],
];

function keywordRoute(text: string): [Industry, string] {
  for (const [pat, ind] of NAME_HINTS) {
    if (pat.test(text)) return [ind, "customer_name_hint"];
  }
  for (const [pat, ind] of KEYWORD_RULES) {
    if (pat.test(text)) return [ind, "keyword_route"];
  }
  return ["unknown", "keyword_route"];
}

function getLastUserText(messages: GraphState["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m._getType() === "human") {
      const c = m.content;
      return typeof c === "string" ? c : String(c);
    }
  }
  return "";
}

function extractTextContent(content: unknown): string {
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

function parseStructuredRouteResponse(raw: string): z.infer<typeof RouteSchema> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const jsonText = fenced?.[1]?.trim() || trimmed;
  try {
    return RouteSchema.parse(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

async function createLLM(env: Env) {
  return createChatOpenAI(env);
}

export function createRouterNode(env: Env) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const text = getLastUserText(state.messages);
    if (!text.trim()) {
      return { industry: "unknown", intent: "empty", toolState: { router: "noop" } };
    }

    try {
      const llm = await createLLM(env);
      const prompt = [
        new HumanMessage(
          `Classify the user's message for routing.\n` +
            `Return only a JSON object with this exact shape: {"industry":"unknown","intent":"short_label"}.\n` +
            `Valid industries: retail, finance, health, unknown.\n` +
            `Do not use markdown fences.\n` +
            `User message:\n${text}`
        ),
      ];
      const response = await llm.invoke(prompt);
      const result = parseStructuredRouteResponse(extractTextContent(response.content));
      if (result) {
        return {
          industry: result.industry as Industry,
          intent: result.intent,
          toolState: { ...state.toolState, router: "llm" },
        };
      }
    } catch {
      // LLM failed, fall through to keyword routing
    }

    const [ind, intent] = keywordRoute(text);
    return { industry: ind, intent, toolState: { ...state.toolState, router: "keyword_fallback" } };
  };
}
