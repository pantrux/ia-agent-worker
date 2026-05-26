import type { Env } from "./env.js";

export type InternalAuthFailureReason = "missing_bearer" | "invalid_token";

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; reason: InternalAuthFailureReason };

function getConfiguredInternalToken(env: Env): string | null {
  const token = env.AGENT_INTERNAL_TOKEN?.trim();
  return token ? token : null;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ua = enc.encode(a);
  const ub = enc.encode(b);
  const maxLen = Math.max(ua.length, ub.length);
  let diff = ua.length ^ ub.length;
  for (let i = 0; i < maxLen; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0);
  return diff === 0;
}

/**
 * Valida llamadas internas omni-channel-worker → ia-agent-worker.
 * Si `AGENT_INTERNAL_TOKEN` no está definido (dev local), no se exige cabecera.
 */
export function verifyInternalApiAuth(request: Request, env: Env): InternalAuthResult {
  const expected = getConfiguredInternalToken(env);
  if (!expected) return { ok: true };

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
