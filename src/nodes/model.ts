import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { getToolsForIndustry } from "../tools/crm.js";
import { createChatOpenAI } from "../llm-client.js";

/** Coincide con `COPILOT_MODEL` por defecto en `wrangler.toml` y el catálogo GitHub Models (`npm run list:github-models`). */
const DEFAULT_MODEL = "openai/gpt-5-mini";

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

    const usedModel = env.COPILOT_MODEL?.trim() || DEFAULT_MODEL;
    const llm = await createLLM(env);
    const bound = llm.bindTools(tools);
    const result = await bound.invoke([systemMsg, ...state.messages]);
    const response = result as AIMessage;

    return {
      messages: [response],
      toolState: { ...state.toolState, model_used: usedModel },
    };
  };
}
