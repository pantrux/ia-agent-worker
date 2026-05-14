import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "./env.js";
import { getCopilotToken } from "./copilot-token.js";
import { resolveAiGatewayLlmConfig } from "./ai-gateway.js";

/** Default estable en catálogo GitHub Models; alineado con trazas que ya funcionaron en producción. */
export const DEFAULT_COPILOT_MODEL = "openai/gpt-4o-mini";

/**
 * Si la base es inferencia GitHub Models, el cuerpo `model` debe ser `{publisher}/{nombre}`.
 * [Openclaw](https://github.com/openclaw/openclaw) usa ids sin publisher (`gpt-5.4-mini` en `extensions/github-copilot/models-defaults.ts`);
 * ante `models.github.ai` añadimos `openai/` solo para ids típicos GPT/o* sin `/`.
 */
export function normalizeModelIdForGithubModelsInference(baseUrl: string, modelId: string): string {
  const base = baseUrl.toLowerCase();
  if (!base.includes("models.github.ai")) {
    return modelId.trim();
  }
  const m = modelId.trim();
  if (!m || m.includes("/")) {
    return m;
  }
  if (/^(gpt-|o\d|o\d-)/i.test(m)) {
    return `openai/${m}`;
  }
  return m;
}

/** ChatOpenAI con credenciales Copilot/GitHub Models y enrutado opcional vía Cloudflare AI Gateway (compat o custom provider). */
export async function createChatOpenAI(env: Env, model?: string): Promise<ChatOpenAI> {
  const upstream = await getCopilotToken(env.COPILOT_GITHUB_TOKEN, env.OPENAI_API_BASE);
  const baseModel = model ?? env.COPILOT_MODEL ?? DEFAULT_COPILOT_MODEL;
  const resolvedModel = normalizeModelIdForGithubModelsInference(upstream.baseUrl, baseModel);
  const cfg = resolveAiGatewayLlmConfig(env, upstream, resolvedModel);
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    configuration: {
      baseURL: cfg.baseUrl,
      ...(cfg.defaultHeaders ? { defaultHeaders: cfg.defaultHeaders } : {}),
    },
  });
}
