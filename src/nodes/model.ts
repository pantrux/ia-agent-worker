import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { getToolsForIndustry } from "../tools/crm.js";
import { createChatOpenAI, DEFAULT_COPILOT_MODEL, normalizeModelIdForGithubModelsInference } from "../llm-client.js";

/** Coincide con `COPILOT_MODEL` por defecto en `wrangler.toml` y `DEFAULT_COPILOT_MODEL` en `llm-client.ts`. */
const DEFAULT_MODEL = DEFAULT_COPILOT_MODEL;

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

    const rawModel = env.COPILOT_MODEL?.trim() || DEFAULT_MODEL;
    const baseForNormalize = env.OPENAI_API_BASE?.trim() || "";
    const usedModel = normalizeModelIdForGithubModelsInference(baseForNormalize, rawModel);
    const fallbackRaw = env.COPILOT_MODEL_FALLBACK?.trim();
    let fallbackModel = "";
    if (fallbackRaw && fallbackRaw !== rawModel) {
      const n = normalizeModelIdForGithubModelsInference(baseForNormalize, fallbackRaw);
      if (n !== usedModel) fallbackModel = n;
    }

    let effectiveModel = usedModel;
    let llm = await createLLM(env, effectiveModel);
    let bound = llm.bindTools(tools);
    let result: AIMessage;
    try {
      result = (await bound.invoke([systemMsg, ...state.messages])) as AIMessage;
    } catch (primaryErr) {
      if (!fallbackModel || fallbackModel === effectiveModel) {
        throw primaryErr;
      }
      effectiveModel = fallbackModel;
      llm = await createLLM(env, effectiveModel);
      bound = llm.bindTools(tools);
      result = (await bound.invoke([systemMsg, ...state.messages])) as AIMessage;
    }

    return {
      messages: [result],
      toolState: { ...state.toolState, model_used: effectiveModel },
    };
  };
}
