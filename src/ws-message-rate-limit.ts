/** Rate limit de mensajes `chat` / `resume` por sesión DO (PAN-34). Ventana fija 60s en estado DO. */

export const WS_MESSAGE_RATE_WINDOW_MS = 60_000;
/** Alineado con supuesto de carga en ADR C3 (10 mensajes/min por sesión). */
export const WS_MESSAGE_RATE_MAX = 10;

export type WsMessageRateLimitFields = {
  wsMsgWindowStartMs?: number;
  wsMsgCount?: number;
};

export type WsMessageRateLimitResult = {
  allowed: boolean;
  statePatch: { wsMsgWindowStartMs: number; wsMsgCount: number };
};

/**
 * Incrementa contador y devuelve si el mensaje está permitido.
 * `ping` no debe llamar a esta función.
 */
export function applyWsMessageRateLimit(
  state: WsMessageRateLimitFields,
  nowMs: number = Date.now()
): WsMessageRateLimitResult {
  const windowStart = state.wsMsgWindowStartMs ?? 0;
  const count = state.wsMsgCount ?? 0;
  const inWindow = windowStart > 0 && nowMs < windowStart + WS_MESSAGE_RATE_WINDOW_MS;

  const nextWindowStart = inWindow ? windowStart : nowMs;
  const nextCount = inWindow ? count + 1 : 1;
  const allowed = nextCount <= WS_MESSAGE_RATE_MAX;

  return {
    allowed,
    statePatch: { wsMsgWindowStartMs: nextWindowStart, wsMsgCount: nextCount },
  };
}

/** Solo tests: reinicia campos de ventana en estado. */
export function resetWsMessageRateLimitFields(): WsMessageRateLimitFields {
  return { wsMsgWindowStartMs: undefined, wsMsgCount: undefined };
}
