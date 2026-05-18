/**
 * Smoke WebSocket directo al Worker (PAN-35), sin pasar por Pages BFF.
 *
 * Requiere:
 *   WORKER_SMOKE_URL — base Worker sin barra final
 *   WS_TICKET_SECRET — mismo valor que Worker/Pages (firma ticket HMAC)
 *
 * Uso:
 *   WORKER_SMOKE_URL=https://ia-agent-worker-preview....workers.dev \\
 *   WS_TICKET_SECRET=... node scripts/smoke-c3-ws.mjs
 *
 * Requiere Node >= 22 (WebSocket global).
 */

const baseRaw = process.env.WORKER_SMOKE_URL?.trim();
const secretRaw = process.env.WS_TICKET_SECRET?.trim();

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!baseRaw) {
  fail(`WORKER_SMOKE_URL no está definida (misma variable que worker-smoke.yml).`);
}
if (!secretRaw) {
  fail(`WS_TICKET_SECRET no está definida (secreto en GitHub Actions para smoke WS directo).`);
}

const base = baseRaw.replace(/\/+$/, "");
const TICKET_TTL_SEC = 60;

function base64UrlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signWsTicket(sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sid: sessionId, exp: now + TICKET_TTL_SEC };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretRaw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

function agentHttpToWs(httpBase) {
  const trimmed = httpBase.replace(/\/$/, "");
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  return trimmed;
}

function smokeWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(
        new Error(
          "WebSocket global no disponible (requiere Node >= 22). Actualiza Node o omite este smoke."
        )
      );
      return;
    }
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let sawReady = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      fn(arg);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error("timeout esperando ready + pong (45s)"));
    }, 45_000);

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const t = msg?.type;
      if (typeof t !== "string" || t.startsWith("cf_agent")) return;

      if (t === "error") {
        finish(reject, new Error(`WS error: ${msg.code ?? "?"} ${msg.message ?? ""}`));
        return;
      }
      if (t === "ready") {
        sawReady = true;
        ws.send(JSON.stringify({ type: "ping" }));
        return;
      }
      if (t === "pong") {
        finish(resolve, undefined);
      }
    });

    ws.addEventListener("error", () => finish(reject, new Error("WebSocket error event")));
    ws.addEventListener("close", (ev) => {
      if (!settled) {
        finish(
          reject,
          new Error(
            sawReady
              ? `cerrado antes de pong (code=${ev.code})`
              : `cerrado antes de ready (code=${ev.code})`
          )
        );
      }
    });
  });
}

async function main() {
  const sessionId = crypto.randomUUID();
  const ticket = await signWsTicket(sessionId);
  const wsBase = agentHttpToWs(base);
  const wsUrl = `${wsBase}/agents/web-session-agent/${encodeURIComponent(sessionId)}?ticket=${encodeURIComponent(ticket)}`;

  console.log(`Smoke C3 WS — Worker: ${base}`);
  console.log(`session_id=${sessionId}\n`);

  try {
    await smokeWebSocket(wsUrl);
    console.log("WS OK (ready + pong)");
  } catch (e) {
    console.error(`FAIL: ${e?.message ?? e}`);
    process.exit(1);
  }

  console.log("\nSmoke C3 WS completado.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
