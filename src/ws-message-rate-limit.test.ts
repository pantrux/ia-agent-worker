import { describe, expect, it } from "vitest";
import {
  applyWsMessageRateLimit,
  WS_MESSAGE_RATE_MAX,
  WS_MESSAGE_RATE_WINDOW_MS,
} from "./ws-message-rate-limit.js";

describe("applyWsMessageRateLimit (PAN-34)", () => {
  const t0 = 1_700_000_000_000;

  it("permite hasta WS_MESSAGE_RATE_MAX mensajes en la ventana", () => {
    let state = {};
    for (let i = 0; i < WS_MESSAGE_RATE_MAX; i++) {
      const r = applyWsMessageRateLimit(state, t0);
      expect(r.allowed).toBe(true);
      state = { ...state, ...r.statePatch };
    }
    expect(state.wsMsgCount).toBe(WS_MESSAGE_RATE_MAX);
  });

  it("rechaza el mensaje WS_MESSAGE_RATE_MAX + 1 en la misma ventana", () => {
    let state = {};
    for (let i = 0; i < WS_MESSAGE_RATE_MAX; i++) {
      const r = applyWsMessageRateLimit(state, t0);
      state = { ...state, ...r.statePatch };
    }
    const blocked = applyWsMessageRateLimit(state, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.statePatch.wsMsgCount).toBe(WS_MESSAGE_RATE_MAX + 1);
  });

  it("reinicia contador tras expirar la ventana", () => {
    let state = {};
    for (let i = 0; i < WS_MESSAGE_RATE_MAX; i++) {
      const r = applyWsMessageRateLimit(state, t0);
      state = { ...state, ...r.statePatch };
    }
    const afterWindow = applyWsMessageRateLimit(state, t0 + WS_MESSAGE_RATE_WINDOW_MS);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.statePatch.wsMsgCount).toBe(1);
  });
});
