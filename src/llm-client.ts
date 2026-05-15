import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "./env.js";
import { getCopilotToken } from "./copilot-token.js";
import { resolveAiGatewayLlmConfig } from "./ai-gateway.js";

/** Por defecto: Copilot Enterprise (ids sin publisher). Con `models.github.ai` se normaliza a `openai/…` si aplica. */
export const DEFAULT_COPILOT_MODEL = "gpt-5.4-mini";

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

const GITHUB_MODELS_USER_INFERENCE = "https://models.github.ai/inference";

/** Reescribe la base de inferencia global a la ruta por organización si aplica. */
export function rewriteGithubModelsBaseForOrg(baseUrl: string, orgLogin: string | undefined): string {
  const org = orgLogin?.trim();
  if (!org) return baseUrl;
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.toLowerCase() === GITHUB_MODELS_USER_INFERENCE) {
    return `https://models.github.ai/orgs/${encodeURIComponent(org)}/inference`;
  }
  return baseUrl;
}

/** Cabeceras que documenta GitHub para la API REST de inferencia (además de `Authorization: Bearer`). */
export function githubModelsInferenceDefaultHeaders(env: Env): Record<string, string> {
  const ver = env.GITHUB_MODELS_API_VERSION?.trim() || "2026-03-10";
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": ver,
  };
}

/** ChatOpenAI con credenciales Copilot/GitHub Models y enrutado opcional vía Cloudflare AI Gateway (compat o custom provider). */
export async function createChatOpenAI(env: Env, model?: string): Promise<ChatOpenAI> {
  const upstreamRaw = await getCopilotToken(env.COPILOT_GITHUB_TOKEN, env.OPENAI_API_BASE);
  const upstream = {
    ...upstreamRaw,
    baseUrl: rewriteGithubModelsBaseForOrg(upstreamRaw.baseUrl, env.GITHUB_MODELS_ORG),
  };
  const baseModel = model ?? env.COPILOT_MODEL ?? DEFAULT_COPILOT_MODEL;
  const resolvedModel = normalizeModelIdForGithubModelsInference(upstream.baseUrl, baseModel);
  const cfg = resolveAiGatewayLlmConfig(env, upstream, resolvedModel);

  const defaultHeaders: Record<string, string> = { ...(cfg.defaultHeaders ?? {}) };
  if (cfg.baseUrl.toLowerCase().includes("models.github.ai")) {
    const gh = githubModelsInferenceDefaultHeaders(env);
    for (const [k, v] of Object.entries(gh)) {
      if (defaultHeaders[k] === undefined) defaultHeaders[k] = v;
    }
  }

  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    configuration: {
      baseURL: cfg.baseUrl,
      ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
    },
  });
}
