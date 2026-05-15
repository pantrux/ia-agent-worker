import type { Env } from "./env.js";

export type BffAuthFailureReason = "missing_bearer" | "invalid_token";

export type BffAuthResult = { ok: true } | { ok: false; reason: BffAuthFailureReason };

function getConfiguredBffToken(env: Env): string | null {
  const t = env.BFF_API_TOKEN?.trim();
  return t ? t : null;
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
 * Si `BFF_API_TOKEN` no está definido en el entorno, no se exige cabecera (compatibilidad y dev).
 * Si está definido, exige `Authorization: Bearer <token>` con comparación resistente a timing.
 */
export function verifyBffApiAuth(request: Request, env: Env): BffAuthResult {
  const expected = getConfiguredBffToken(env);
  if (!expected) return { ok: true };

  const raw = request.headers.get("Authorization")?.trim() ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(raw);
  const presented = m?.[1]?.trim() ?? "";
  if (!presented) return { ok: false, reason: "missing_bearer" };
  if (!timingSafeEqualUtf8(presented, expected)) return { ok: false, reason: "invalid_token" };
  return { ok: true };
}

/** UUID v4 (RFC 4122). */
const AAAS_USER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `true` si el Worker exige autenticación BFF (solo entonces se confía en `X-AAAS-User-Id`). */
export function isBffBearerConfigured(env: Env): boolean {
  return Boolean(getConfiguredBffToken(env));
}

/**
 * Lee `X-AAAS-User-Id` solo cuando `BFF_API_TOKEN` está configurado (el caller autenticó al BFF).
 * Si el token BFF no está definido (dev laxo), se ignora la cabecera.
 */
export function parseTrustedAaasUserIdHeader(request: Request, env: Env): string | undefined {
  if (!isBffBearerConfigured(env)) return undefined;
  const raw = request.headers.get("X-AAAS-User-Id")?.trim() ?? "";
  if (!raw || !AAAS_USER_UUID_RE.test(raw)) return undefined;
  return raw;
}
