import type { Env } from "./env.js";

/** Unified API OpenAI-compat (sin barra final). Sin custom provider en la ruta. */
export function aiGatewayCompatBaseUrl(accountId: string, gatewayId: string): string {
  const a = accountId.trim();
  const g = gatewayId.trim();
  return `https://gateway.ai.cloudflare.com/v1/${a}/${g}/compat`;
}

/**
 * URL `…/custom-{slug}` (provider-specific). Reservada por si hace falta; el flujo OpenAI SDK
 * recomendado con custom providers es **`/compat`** + modelo `custom-{slug}/…`.
 * @see https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/
 */
export function aiGatewayCustomProviderBaseUrl(accountId: string, gatewayId: string, slugWithoutCustomPrefix: string): string {
  const a = accountId.trim();
  const g = gatewayId.trim();
  const s = slugWithoutCustomPrefix.replace(/^custom-/, "").trim();
  return `https://gateway.ai.cloudflare.com/v1/${a}/${g}/custom-${s}`;
}

export type UpstreamLlmCredentials = { apiKey: string; baseUrl: string };

function stripCustomProviderModelPrefix(model: string, slugClean: string): string {
  const prefix = `custom-${slugClean}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

/**
 * Si `AI_GATEWAY_ACCOUNT_ID` e `AI_GATEWAY_ID` están definidos, enruta las llamadas por AI Gateway.
 *
 * - Con **`AI_GATEWAY_PROVIDER_SLUG`**: API unificada **`/compat`** y modelo `custom-{slug}/{modelo}`
 *   (patrón recomendado por Cloudflare para el SDK OpenAI con custom providers).
 * - Sin slug: **`/compat`** con el `model` tal cual.
 *
 * `AI_GATEWAY_API_TOKEN` opcional → `cf-aig-authorization`.
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

  const gwToken = env.AI_GATEWAY_API_TOKEN?.trim();
  const defaultHeaders: Record<string, string> = {};
  if (gwToken) {
    defaultHeaders["cf-aig-authorization"] = `Bearer ${gwToken}`;
  }

  const slug = env.AI_GATEWAY_PROVIDER_SLUG?.trim();
  if (slug) {
    const slugClean = slug.replace(/^custom-/, "").trim();
    const baseUrl = aiGatewayCompatBaseUrl(accountId, gatewayId);
    if (!slugClean) {
      return {
        apiKey: upstream.apiKey,
        baseUrl,
        model,
        ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
      };
    }
    const customPrefix = `custom-${slugClean}/`;
    const upstreamModel = stripCustomProviderModelPrefix(model, slugClean);
    const compatModel = model.startsWith(customPrefix) ? model : `${customPrefix}${upstreamModel}`;
    return {
      apiKey: upstream.apiKey,
      baseUrl,
      model: compatModel,
      ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
    };
  }

  const baseUrl = aiGatewayCompatBaseUrl(accountId, gatewayId);
  return {
    apiKey: upstream.apiKey,
    baseUrl,
    model,
    ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
  };
}
