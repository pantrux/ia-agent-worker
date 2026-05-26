import type { Env } from "./env.js";
import { timingSafeEqualUtf8 } from "./timing-safe-equal.js";

export type InternalAuthFailureReason =
  | "missing_bearer"
  | "invalid_token"
  | "token_not_configured";

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; reason: InternalAuthFailureReason };

export type VerifyInternalApiAuthOptions = {
  /** En `/v2/agent/*` el token debe estar configurado; si falta, fallar cerrado. */
  requireConfigured?: boolean;
};

function getConfiguredInternalToken(env: Env): string | null {
  const token = env.AGENT_INTERNAL_TOKEN?.trim();
  return token ? token : null;
}

/**
 * Valida llamadas internas omni-channel-worker → ia-agent-worker.
 * Con `requireConfigured: true` (rutas v2), rechaza si falta `AGENT_INTERNAL_TOKEN`.
 */
export function verifyInternalApiAuth(
  request: Request,
  env: Env,
  options: VerifyInternalApiAuthOptions = {}
): InternalAuthResult {
  const expected = getConfiguredInternalToken(env);
  if (!expected) {
    if (options.requireConfigured) return { ok: false, reason: "token_not_configured" };
    return { ok: true };
  }

  const raw = request.headers.get("Authorization")?.trim() ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(raw);
  const presented = match?.[1]?.trim() ?? "";
  if (!presented) return { ok: false, reason: "missing_bearer" };
  if (!timingSafeEqualUtf8(presented, expected)) {
    return { ok: false, reason: "invalid_token" };
  }
  return { ok: true };
}

export function isInternalBearerConfigured(env: Env): boolean {
  return Boolean(getConfiguredInternalToken(env));
}
