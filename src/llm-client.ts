import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "./env.js";
import { getCopilotToken } from "./copilot-token.js";
import { resolveAiGatewayLlmConfig } from "./ai-gateway.js";

/** ChatOpenAI con credenciales Copilot/GitHub Models y enrutado opcional vía Cloudflare AI Gateway (compat o custom provider). */
export async function createChatOpenAI(env: Env, model?: string): Promise<ChatOpenAI> {
  const upstream = await getCopilotToken(env.COPILOT_GITHUB_TOKEN, env.OPENAI_API_BASE);
  const baseModel = model ?? env.COPILOT_MODEL ?? "openai/gpt-5.4-mini";
  const cfg = resolveAiGatewayLlmConfig(env, upstream, baseModel);
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    configuration: {
      baseURL: cfg.baseUrl,
      ...(cfg.defaultHeaders ? { defaultHeaders: cfg.defaultHeaders } : {}),
    },
  });
}
