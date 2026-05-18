/** Pausa entre `reply_delta` para que el navegador pinte (DO/AI Gateway; PAN-33: 25 ms). */
export const WS_STREAM_PACE_MS = 25;

export function wsStreamPauseMs(ms: number = WS_STREAM_PACE_MS): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
