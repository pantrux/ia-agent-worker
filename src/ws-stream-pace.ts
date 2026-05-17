/** Pausa entre trozos WS para que el navegador pinte (microtasks no bastan en DO/AI Gateway). */
export const WS_STREAM_PACE_MS = 20;

export function wsStreamPauseMs(ms: number = WS_STREAM_PACE_MS): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
