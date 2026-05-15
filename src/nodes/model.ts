import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { getToolsForIndustry } from "../tools/crm.js";
import { createChatOpenAI, DEFAULT_COPILOT_MODEL, normalizeModelIdForGithubModelsInference, remapCopilotModelIdForChatCompletions } from "../llm-client.js";

/** Coincide con `COPILOT_MODEL` por defecto en `wrangler.toml` y `DEFAULT_COPILOT_MODEL` en `llm-client.ts`. */
const DEFAULT_MODEL = DEFAULT_COPILOT_MODEL;

async function createLLM(env: Env, model?: string) {
  return createChatOpenAI(env, model);
}

function errorHint(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
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
    const usedModel = remapCopilotModelIdForChatCompletions(
      baseForNormalize,
      normalizeModelIdForGithubModelsInference(baseForNormalize, rawModel)
    );
    const fallbackRaw = env.COPILOT_MODEL_FALLBACK?.trim();
    let fallbackModel = "";
    if (fallbackRaw && fallbackRaw !== rawModel) {
      const n = remapCopilotModelIdForChatCompletions(
        baseForNormalize,
        normalizeModelIdForGithubModelsInference(baseForNormalize, fallbackRaw)
      );
      if (n !== usedModel) fallbackModel = n;
    }

    let effectiveModel = usedModel;
    let llm = await createLLM(env, effectiveModel);
    let bound = llm.bindTools(tools);
    let result: AIMessage;
    let primaryErr: unknown;
    try {
      result = (await bound.invoke([systemMsg, ...state.messages])) as AIMessage;
    } catch (e) {
      primaryErr = e;
      if (!fallbackModel || fallbackModel === effectiveModel) {
        throw e;
      }
      console.warn(`[model] Fallo del modelo principal "${usedModel}", reintento con "${fallbackModel}":`, e);
      effectiveModel = fallbackModel;
      llm = await createLLM(env, effectiveModel);
      bound = llm.bindTools(tools);
      result = (await bound.invoke([systemMsg, ...state.messages])) as AIMessage;
    }

    const usedFallback = effectiveModel !== usedModel;
    return {
      messages: [result],
      toolState: {
        ...state.toolState,
        model_used: effectiveModel,
        ...(usedFallback && primaryErr !== undefined
          ? { model_fallback_from: usedModel, model_primary_error_hint: errorHint(primaryErr) }
          : {}),
      },
    };
  };
}
