import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { getToolsForIndustry } from "../tools/crm.js";
import { createChatOpenAI } from "../llm-client.js";

/** Coincide con `COPILOT_MODEL` por defecto en `wrangler.toml`. */
const DEFAULT_PRIMARY_MODEL = "openai/gpt-5.4-mini";
/** Si el primario falla (modelo no soportado / sin acceso 403, etc.), se intenta este. */
const FALLBACK_MODEL = "openai/gpt-4o-mini";

function shouldRetryWithFallbackModel(err: unknown): boolean {
  const t = String(err);
  const lower = t.toLowerCase();
  if (t.includes("model_not_supported")) return true;
  if (lower.includes("requested model is not supported")) return true;
  if (t.includes("No access to model")) return true;
  if (t.includes("403") && lower.includes("model")) return true;
  return false;
}

async function createLLM(env: Env, model?: string) {
  return createChatOpenAI(env, model);
}

export function createModelNode(env: Env) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const industry = state.industry;
    const intent = state.intent;
    const tools = getToolsForIndustry(industry, env.DB);

    const systemMsg = new SystemMessage(
      `You are a CRM assistant. Use tools to read or change data when appropriate.\n` +
        `Detected industry: ${industry}. Intent hint: ${intent}.\n` +
        `If the user gives a customer name but not id, call find_customer_by_name first.\n` +
        `Prefer tools over guessing. Keep answers concise.`
    );

    const llm = await createLLM(env);
    const bound = llm.bindTools(tools);

    let response: AIMessage;
    let usedModel = env.COPILOT_MODEL?.trim() || DEFAULT_PRIMARY_MODEL;

    try {
      const result = await bound.invoke([systemMsg, ...state.messages]);
      response = result as AIMessage;
    } catch (e: unknown) {
      if (!shouldRetryWithFallbackModel(e)) throw e;
      if (FALLBACK_MODEL === usedModel) throw e;
      const fbLlm = (await createLLM(env, FALLBACK_MODEL)).bindTools(tools);
      const result = await fbLlm.invoke([systemMsg, ...state.messages]);
      response = result as AIMessage;
      usedModel = FALLBACK_MODEL;
    }

    return {
      messages: [response],
      toolState: { ...state.toolState, model_used: usedModel },
    };
  };
}
