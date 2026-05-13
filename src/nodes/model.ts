import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { getToolsForIndustry } from "../tools/crm.js";
import { getCopilotToken } from "../copilot-token.js";

async function createLLM(env: Env, model?: string): Promise<ChatOpenAI> {
  const { apiKey, baseUrl } = await getCopilotToken(env.COPILOT_GITHUB_TOKEN);
  return new ChatOpenAI({
    model: model || env.COPILOT_MODEL || "gpt-5.4-mini",
    apiKey,
    configuration: { baseURL: baseUrl || env.OPENAI_API_BASE },
  });
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
    let usedModel = env.COPILOT_MODEL || "gpt-5.4-mini";

    try {
      const result = await bound.invoke([systemMsg, ...state.messages]);
      response = result as AIMessage;
    } catch (e: unknown) {
      const errText = String(e);
      if (!errText.includes("model_not_supported") && !errText.toLowerCase().includes("requested model is not supported")) {
        throw e;
      }
      const fallbackModel = "gpt-5.4";
      if (fallbackModel === usedModel) throw e;
      const fbLlm = (await createLLM(env, fallbackModel)).bindTools(tools);
      const result = await fbLlm.invoke([systemMsg, ...state.messages]);
      response = result as AIMessage;
      usedModel = fallbackModel;
    }

    return {
      messages: [response],
      toolState: { ...state.toolState, model_used: usedModel },
    };
  };
}
