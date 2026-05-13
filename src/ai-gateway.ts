import type { Env } from "./env.js";

/** OpenAI-compatible unified endpoint (sin barra final). */
export function aiGatewayCompatBaseUrl(accountId: string, gatewayId: string): string {
  const a = accountId.trim();
  const g = gatewayId.trim();
  return `https://gateway.ai.cloudflare.com/v1/${a}/${g}/compat`;
}

export type UpstreamLlmCredentials = { apiKey: string; baseUrl: string };

/**
 * Si `AI_GATEWAY_ACCOUNT_ID` e `AI_GATEWAY_ID` están definidos, enruta las llamadas
 * al endpoint compat del AI Gateway; el `apiKey` sigue siendo el del proveedor (p. ej. GitHub).
 * Opcional: `AI_GATEWAY_API_TOKEN` → cabecera `cf-aig-authorization` (gateway autenticado).
 * Opcional: `AI_GATEWAY_PROVIDER_SLUG` → prefijo del modelo `slug/modelo` (proveedor personalizado en AI Gateway).
 */
export function resolveAiGatewayLlmConfig(
  env: Env,
  upstream: UpstreamLlmCredentials,
  model: string
): { apiKey: string; baseUrl: string; model: string; defaultHeaders?: Record<string, string> } {
  const accountId = env.AI_GATEWAY_ACCOUNT_ID?.trim();
  const gatewayId = env.AI_GATEWAY_ID?.trim();
  if (!accountId || !gatewayId) {
    return { apiKey: upstream.apiKey, baseUrl: upstream.baseUrl, model };
  }

  const baseUrl = aiGatewayCompatBaseUrl(accountId, gatewayId);
  const gwToken = env.AI_GATEWAY_API_TOKEN?.trim();
  const defaultHeaders: Record<string, string> = {};
  if (gwToken) {
    defaultHeaders["cf-aig-authorization"] = `Bearer ${gwToken}`;
  }

  const slug = env.AI_GATEWAY_PROVIDER_SLUG?.trim();
  let resolvedModel = model;
  if (slug && !model.startsWith(`${slug}/`)) {
    resolvedModel = `${slug}/${model}`;
  }

  return {
    apiKey: upstream.apiKey,
    baseUrl,
    model: resolvedModel,
    ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
  };
}
