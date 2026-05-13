import type { Env } from "./env.js";

/** Unified API OpenAI-compat (sin barra final). Sin custom provider en la ruta. */
export function aiGatewayCompatBaseUrl(accountId: string, gatewayId: string): string {
  const a = accountId.trim();
  const g = gatewayId.trim();
  return `https://gateway.ai.cloudflare.com/v1/${a}/${g}/compat`;
}

/**
 * Endpoint provider-specific: el SDK añade `/chat/completions` →
 * `…/custom-{slug}/chat/completions` y el gateway reenvía a `{base_url}/chat/completions`.
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
 * - Con **`AI_GATEWAY_PROVIDER_SLUG`**: ruta **provider-specific** (`…/custom-{slug}`), cuerpo con el
 *   mismo `model` que el proveedor (p. ej. `openai/gpt-4o-mini`). Evita `/compat`, donde el upstream
 *   para GitHub Models puede resolverse a paths inválidos.
 * - Sin slug: endpoint **compat** (`…/compat`).
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
    if (!slugClean) {
      const baseUrl = aiGatewayCompatBaseUrl(accountId, gatewayId);
      return {
        apiKey: upstream.apiKey,
        baseUrl,
        model,
        ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
      };
    }
    const baseUrl = aiGatewayCustomProviderBaseUrl(accountId, gatewayId, slugClean);
    const resolvedModel = stripCustomProviderModelPrefix(model, slugClean);
    return {
      apiKey: upstream.apiKey,
      baseUrl,
      model: resolvedModel,
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
