/**
 * Exchange a GitHub OAuth/PAT token (ghu_*) for a short-lived Copilot session token.
 * Mirrors the Python logic in ia-agent-mvp/auth/token_store.py.
 */

interface TokenCache {
  token: string;
  expiresAt: number;
  baseUrl: string;
}

let cache: TokenCache = { token: "", expiresAt: 0, baseUrl: "" };

const DEFAULT_BASE = "https://api.individual.githubcopilot.com";
const EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
/** Alineado con Openclaw (`X-Github-Api-Version` en el intercambio `copilot_internal/v2/token`). */
const COPILOT_EXCHANGE_GITHUB_API_VERSION = "2025-04-01";

function exchangeHeaders(githubToken: string, useBearer: boolean): Record<string, string> {
  return {
    Authorization: useBearer ? `Bearer ${githubToken}` : `token ${githubToken}`,
    Accept: "application/json",
    "Copilot-Integration-Id": "vscode-chat",
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "User-Agent": "GitHubCopilotChat/0.35.0",
    "X-Github-Api-Version": COPILOT_EXCHANGE_GITHUB_API_VERSION,
  };
}

/**
 * Get credentials for LLM API calls.
 * - If baseUrl is NOT the Copilot internal API, skip exchange and use raw token (e.g. GitHub Models).
 * - If baseUrl IS the Copilot API, attempt token exchange.
 */
export async function getCopilotToken(ghToken: string, baseUrl?: string): Promise<{ apiKey: string; baseUrl: string }> {
  const resolvedBase = baseUrl || DEFAULT_BASE;

  // GitHub Models and other non-Copilot endpoints: use token directly
  if (!resolvedBase.includes("githubcopilot.com")) {
    return { apiKey: ghToken, baseUrl: resolvedBase };
  }

  const now = Date.now() / 1000;
  if (cache.token && now < cache.expiresAt - 30) {
    return { apiKey: cache.token, baseUrl: cache.baseUrl };
  }

  try {
    let lastExchangeStatus: { scheme: string; status: number } | undefined;
    for (const useBearer of [true, false]) {
      const scheme = useBearer ? "Bearer" : "token";
      const resp = await fetch(EXCHANGE_URL, { headers: exchangeHeaders(ghToken, useBearer) });
      if (!resp.ok) {
        lastExchangeStatus = { scheme, status: resp.status };
        continue;
      }
      const data = (await resp.json()) as Record<string, unknown>;
      const token = String(data.token ?? "").trim();
      if (token) {
        const expiresAt = Number(data.expires_at) || now + 25 * 60;
        const derivedBase = deriveBaseUrl(token, data, resolvedBase);
        cache = { token, expiresAt, baseUrl: derivedBase };
        return { apiKey: token, baseUrl: derivedBase };
      }
    }
    if (lastExchangeStatus) {
      console.warn(
        `[copilot-token] Intercambio sin éxito: esquema ${lastExchangeStatus.scheme} → HTTP ${lastExchangeStatus.status}`
      );
    }
  } catch {
    // Exchange failed — fall through to raw token
  }

  return { apiKey: ghToken, baseUrl: resolvedBase };
}

function deriveBaseUrl(_sessionToken: string, payload: Record<string, unknown>, configuredBase: string): string {
  for (const key of ["base_url", "baseUrl", "api_url", "endpoint"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\/$/, "");
  }
  const ep = payload.endpoints;
  if (ep && typeof ep === "object") {
    for (const key of ["api", "chat", "models"]) {
      const v = (ep as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v.trim().replace(/\/$/, "");
    }
  }
  const trimmed = configuredBase.trim().replace(/\/$/, "");
  if (trimmed.includes("githubcopilot.com")) {
    return trimmed;
  }
  return DEFAULT_BASE;
}
