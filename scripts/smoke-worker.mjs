/**
 * Smoke HTTP contra el Worker desplegado (preview o prod).
 *
 * Requiere: WORKER_SMOKE_URL — base sin barra final, ej. https://ia-agent-worker.tu-subdominio.workers.dev
 *
 * Opcional:
 *   SMOKE_INCLUDE_CHAT=1 — además POST /api/chat (cuesta tokens; el Worker debe tener COPILOT_GITHUB_TOKEN).
 *   WORKER_SMOKE_BFF_TOKEN — si el Worker tiene secreto BFF_API_TOKEN, mismo valor aquí para enviar Authorization: Bearer.
 *
 * Uso local: WORKER_SMOKE_URL=https://... workers.dev node scripts/smoke-worker.mjs
 */
const baseRaw = process.env.WORKER_SMOKE_URL?.trim();
const includeChat =
  process.env.SMOKE_INCLUDE_CHAT === "1" ||
  process.env.SMOKE_INCLUDE_CHAT === "true";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!baseRaw) {
  fail(`WORKER_SMOKE_URL no está definida.

Define la URL base del Worker (sin path final), por ejemplo:
  export WORKER_SMOKE_URL=https://ia-agent-worker.<account>.workers.dev

En GitHub: Settings → Secrets and variables → Actions → Variables → WORKER_SMOKE_URL
`);
}

const base = baseRaw.replace(/\/+$/, "");

async function getPing() {
  const url = `${base}/ping`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, url, status: r.status, err: `Body no JSON: ${text.slice(0, 120)}` };
    }
    if (!r.ok) return { ok: false, url, status: r.status, err: JSON.stringify(data) };
    if (data?.status !== "ok" || data?.service !== "ia-agent-worker") {
      return { ok: false, url, status: r.status, err: `JSON inesperado: ${JSON.stringify(data)}` };
    }
    return { ok: true, url, status: r.status, data };
  } catch (e) {
    return {
      ok: false,
      url,
      err: String(e?.cause?.message ?? e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function postChat() {
  const url = `${base}/api/chat`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120000);
  const headers = { "Content-Type": "application/json" };
  const bff = process.env.WORKER_SMOKE_BFF_TOKEN?.trim();
  if (bff) headers["Authorization"] = `Bearer ${bff}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers,
      body: JSON.stringify({
        message: "Responde solo con la palabra exacta: PONG",
      }),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, url, status: r.status, err: `Body no JSON: ${text.slice(0, 200)}` };
    }
    if (!r.ok) return { ok: false, url, status: r.status, err: JSON.stringify(data) };
    if (typeof data?.thread_id !== "string" || typeof data?.reply !== "string") {
      return { ok: false, url, status: r.status, err: `Campos faltantes: ${JSON.stringify(data)}` };
    }
    if (data.status === "pending_approval") {
      console.warn("[smoke] chat devolvió pending_approval (HITL); se considera OK estructural.");
    }
    return { ok: true, url, status: r.status, data };
  } catch (e) {
    return {
      ok: false,
      url,
      err: String(e?.cause?.message ?? e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log(`Smoke Worker — base: ${base}\n`);

  const ping = await getPing();
  if (!ping.ok) {
    console.error(`GET /ping FAIL\n  ${ping.url}\n  ${ping.err ?? `HTTP ${ping.status}`}`);
    process.exit(1);
  }
  console.log(`GET /ping OK (${ping.status}) → ${JSON.stringify(ping.data)}`);

  if (includeChat) {
    console.log("\nPOST /api/chat (SMOKE_INCLUDE_CHAT)…");
    const chat = await postChat();
    if (!chat.ok) {
      console.error(`POST /api/chat FAIL\n  ${chat.url}\n  ${chat.err ?? `HTTP ${chat.status}`}`);
      process.exit(1);
    }
    console.log(`POST /api/chat OK (${chat.status}) thread_id=${chat.data.thread_id?.slice(0, 8)}…`);
  } else {
    console.log("\n(Omite chat: sin SMOKE_INCLUDE_CHAT; solo /ping.)");
  }

  console.log("\nSmoke completado.");
}

main();
