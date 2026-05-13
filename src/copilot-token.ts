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
    const resp = await fetch(EXCHANGE_URL, {
      headers: {
        Authorization: `token ${ghToken}`,
        Accept: "application/json",
        "Editor-Version": "vscode/1.90.0",
        "Editor-Plugin-Version": "copilot-chat/0.17.2024051401",
        "User-Agent": "GitHubCopilot/1.155.0",
      },
    });

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      const token = String(data.token ?? "").trim();
      if (token) {
        const expiresAt = Number(data.expires_at) || now + 25 * 60;
        const derivedBase = deriveBaseUrl(token, data);
        cache = { token, expiresAt, baseUrl: derivedBase };
        return { apiKey: token, baseUrl: derivedBase };
      }
    }
  } catch {
    // Exchange failed — fall through to raw token
  }

  return { apiKey: ghToken, baseUrl: resolvedBase };
}

function deriveBaseUrl(token: string, payload: Record<string, unknown>): string {
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
  return DEFAULT_BASE;
}
