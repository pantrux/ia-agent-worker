import { AIMessage, AIMessageChunk, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { readChatWsTokenDeltaHandler, textDeltaFromMessageContent } from "../chat-ws-stream.js";
import { getToolsForIndustry } from "../tools/crm.js";
import {
  createChatOpenAI,
  DEFAULT_COPILOT_MODEL,
  normalizeModelIdForGithubModelsInference,
} from "../llm-client.js";
import { invokeResponsesIfRequired } from "../responses-client.js";

/** Coincide con `COPILOT_MODEL` por defecto en `wrangler.toml` y `DEFAULT_COPILOT_MODEL` en `llm-client.ts`. */
const DEFAULT_MODEL = DEFAULT_COPILOT_MODEL;

async function createLLM(env: Env, model?: string) {
  return createChatOpenAI(env, model);
}

export function createModelNode(env: Env) {
  return async (state: GraphState, config?: RunnableConfig): Promise<Partial<GraphState>> => {
    const onTokenDelta = readChatWsTokenDeltaHandler(config);
    const industry = state.industry;
    const intent = state.intent;
    const tools = getToolsForIndustry(industry, env.DB);

    const deleteHint = /delete_customer/i.test(intent)
      ? "\nThe user requested deleting a customer: you MUST call delete_customer_record with customer_id (use find_customer_by_name first if needed). Do not answer with text only.\n"
      : "";

    const systemMsg = new SystemMessage(
      `You are a CRM assistant. Use tools to read or change data when appropriate.\n` +
        `Detected industry: ${industry}. Intent hint: ${intent}.\n` +
        `If the user gives a customer name but not id, call find_customer_by_name first.\n` +
        `Prefer tools over guessing. Keep answers concise.` +
        deleteHint
    );

    const rawModel = env.COPILOT_MODEL?.trim() || DEFAULT_MODEL;
    const baseForNormalize = env.OPENAI_API_BASE?.trim() || "";
    const usedModel = normalizeModelIdForGithubModelsInference(baseForNormalize, rawModel);
    const responsesResult = await invokeResponsesIfRequired(
      env,
      [systemMsg, ...state.messages],
      tools,
      usedModel,
      onTokenDelta
    );
    if (responsesResult) {
      return {
        messages: [responsesResult],
        toolState: {
          ...state.toolState,
          model_used: usedModel,
          model_transport: "responses",
        },
      };
    }

    const llm = await createLLM(env, usedModel);
    const bound = llm.bindTools(tools);
    const input = [systemMsg, ...state.messages];
    let result: AIMessage;
    if (onTokenDelta) {
      const stream = await bound.stream(input);
      let gathered: AIMessageChunk | undefined;
      for await (const chunk of stream) {
        const delta = textDeltaFromMessageContent(chunk.content);
        if (delta) onTokenDelta(delta);
        gathered = gathered ? gathered.concat(chunk) : chunk;
      }
      result = gathered
        ? new AIMessage({
            content: gathered.content,
            tool_calls: gathered.tool_calls,
            additional_kwargs: gathered.additional_kwargs,
            response_metadata: gathered.response_metadata,
          })
        : new AIMessage({ content: "" });
    } else {
      result = (await bound.invoke(input)) as AIMessage;
    }

    return {
      messages: [result],
      toolState: {
        ...state.toolState,
        model_used: usedModel,
      },
    };
  };
}
