/** Pausa entre trozos WS para que el navegador pinte (microtasks no bastan en DO/AI Gateway). */
/** Pausa entre `reply_delta` (prod PAN-33: 20 ms → 25 ms ≈ +25 % más lento). */
export const WS_STREAM_PACE_MS = 25;

export function wsStreamPauseMs(ms: number = WS_STREAM_PACE_MS): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
