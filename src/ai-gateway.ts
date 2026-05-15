import type { Env } from "./env.js";

/** Unified API OpenAI-compat (sin barra final). Sin custom provider en la ruta. */
export function aiGatewayCompatBaseUrl(accountId: string, gatewayId: string): string {
  const a = accountId.trim();
  const g = gatewayId.trim();
  return `https://gateway.ai.cloudflare.com/v1/${a}/${g}/compat`;
}

/**
 * URL `…/custom-{slug}` (provider-specific, sin `/compat`).
 * @see https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/
 */
export function aiGatewayCustomProviderBaseUrl(accountId: string, gatewayId: string, slugWithoutCustomPrefix: string): string {
  const a = accountId.trim();
  const g = gatewayId.trim();
  const s = slugWithoutCustomPrefix.replace(/^custom-/, "").trim();
  return `https://gateway.ai.cloudflare.com/v1/${a}/${g}/custom-${s}`;
}

export type UpstreamLlmCredentials = { apiKey: string; baseUrl: string };

function isAiGatewayExplicitlyDisabled(env: Env): boolean {
  const v = env.AI_GATEWAY_DISABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function stripCustomProviderModelPrefix(model: string, slugClean: string): string {
  const prefix = `custom-${slugClean}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

/**
 * Si **`AI_GATEWAY_DISABLED`** es `1`/`true`/`yes`/`on`, devuelve credenciales upstream sin gateway (prueba directa a `OPENAI_API_BASE`).
 *
 * Si `AI_GATEWAY_ACCOUNT_ID` e `AI_GATEWAY_ID` están definidos, enruta las llamadas por AI Gateway.
 *
 * - Con **`AI_GATEWAY_PROVIDER_SLUG`** (proveedor «provider-specific» en Cloudflare):
 *   - **GitHub Models:** `base_url` del proveedor = `https://models.github.ai` (solo host). El Worker usa
 *     `…/custom-{slug}/inference` (o `AI_GATEWAY_PROVIDER_PATH`); el SDK añade `/chat/completions` →
 *     `…/inference/chat/completions` upstream (ver `provision-ai-gateway.mjs`).
 *   - **GitHub Copilot Enterprise:** mismo `base_url` host Copilot en Cloudflare, pero el Worker usa la API unificada
 *     **`/compat`** y el campo `model` como **`custom-{slug}/{modelo}`** (recomendación Cloudflare para OpenAI-compat).
 *     Evita la ruta `…/custom-{slug}/v1/…`, que en algunos despliegues del gateway devolvía **400 / código 2005**
 *     («Failed to get response from provider») sin cuerpo útil del upstream.
 * - Sin slug: **`/compat`** con el `model` tal cual.
 *
 * `AI_GATEWAY_API_TOKEN` opcional → `cf-aig-authorization`.
 */
export function resolveAiGatewayLlmConfig(
  env: Env,
  upstream: UpstreamLlmCredentials,
  model: string
): { apiKey: string; baseUrl: string; model: string; defaultHeaders?: Record<string, string> } {
  if (isAiGatewayExplicitlyDisabled(env)) {
    return { apiKey: upstream.apiKey, baseUrl: upstream.baseUrl, model };
  }

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
    const upstreamIsCopilot = upstream.baseUrl.toLowerCase().includes("githubcopilot.com");
    const gatewayRoot = aiGatewayCustomProviderBaseUrl(accountId, gatewayId, slugClean);

    // Para GitHub Models el default es "inference" (-> /inference/chat/completions).
    // Para Copilot, el default debe ser vacío (-> /chat/completions, ya que Cloudflare /compat fuerza /v1/chat/completions que Copilot rechaza con 2005).
    const isExplicitPath = env.AI_GATEWAY_PROVIDER_PATH !== undefined && env.AI_GATEWAY_PROVIDER_PATH.trim() !== "";
    const rawPath = env.AI_GATEWAY_PROVIDER_PATH?.trim().replace(/^\/+/, "").replace(/\/+$/, "") ?? "";
    
    let providerPath = "";
    if (isExplicitPath) {
      providerPath = rawPath;
    } else {
      providerPath = upstreamIsCopilot ? "" : "inference";
    }

    const baseUrl = providerPath ? `${gatewayRoot}/${providerPath}` : gatewayRoot;
    const upstreamModel = stripCustomProviderModelPrefix(model, slugClean);
    
    return {
      apiKey: upstream.apiKey,
      baseUrl,
      model: upstreamModel,
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
