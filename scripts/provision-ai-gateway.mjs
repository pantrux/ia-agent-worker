#!/usr/bin/env node
/**
 * Crea (si no existen) un AI Gateway y un custom provider hacia GitHub Models,
 * usando la API v4 de Cloudflare. Idempotente.
 *
 * Requisitos:
 * - CLOUDFLARE_API_TOKEN con permisos «AI Gateway — Edit» (y lectura de cuenta).
 * - CLOUDFLARE_ACCOUNT_ID (opcional: si falta, se usa el primer account de `wrangler whoami --json`).
 *
 * Opcional: AI_GATEWAY_ID (default: ia-agent-worker-llm),
 *           AI_GATEWAY_PROVIDER_SLUG (default: github-models),
 *           AI_GATEWAY_CUSTOM_BASE_URL (default: https://models.github.ai/inference).
 *
 * Carga opcional: fichero .env.ai-gateway.local (no versionar; ver .env.ai-gateway.example).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const localEnv = resolve(root, ".env.ai-gateway.local");
if (existsSync(localEnv)) {
  config({ path: localEnv });
}
config({ path: resolve(root, ".env") });

const API = "https://api.cloudflare.com/client/v4";

const gatewayId = (process.env.AI_GATEWAY_ID || "ia-agent-worker-llm").trim();
const providerSlug = (process.env.AI_GATEWAY_PROVIDER_SLUG || "github-models").trim();
const customBaseUrl = (process.env.AI_GATEWAY_CUSTOM_BASE_URL || "https://models.github.ai/inference").trim();
const token = (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();

function wranglerAccountId() {
  const r = spawnSync("npx", ["wrangler", "whoami", "--json"], {
    cwd: root,
    encoding: "utf-8",
    shell: true,
  });
  if (r.status !== 0 || !r.stdout) {
    console.error("No se pudo ejecutar `wrangler whoami --json`. Instala dependencias y haz login (`npx wrangler login`).");
    process.exit(1);
  }
  try {
    const j = JSON.parse(r.stdout);
    const id = j.accounts?.[0]?.id;
    return typeof id === "string" ? id.trim() : "";
  } catch {
    return "";
  }
}

let accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
if (!accountId) {
  accountId = wranglerAccountId();
}
if (!accountId) {
  console.error("Falta CLOUDFLARE_ACCOUNT_ID y no se pudo inferir desde wrangler.");
  process.exit(1);
}

if (!token) {
  console.error(
    "Falta CLOUDFLARE_API_TOKEN (o CF_API_TOKEN).\n" +
      "Crea un API Token en Cloudflare con permiso «Account — AI Gateway — Edit» (y lectura de cuenta si aplica).\n" +
      "Ejemplo (PowerShell):\n" +
      "  $env:CLOUDFLARE_API_TOKEN=\"...\"\n" +
      "  npm run provision:ai-gateway"
  );
  process.exit(1);
}

async function cf(path, init = {}) {
  const url = `${API}/accounts/${accountId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 500)}`);
    err.json = json;
    err.status = res.status;
    throw err;
  }
  if (json.success === false) {
    const err = new Error(`API error ${path}: ${JSON.stringify(json.errors || json)}`);
    err.json = json;
    throw err;
  }
  return json;
}

function extractGatewayList(body) {
  const r = body.result;
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.gateways)) return r.gateways;
  if (Array.isArray(r?.data)) return r.data;
  return [];
}

function extractProviderList(body) {
  const r = body.result;
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.providers)) return r.providers;
  if (Array.isArray(r?.data)) return r.data;
  return [];
}

async function ensureGateway() {
  const list = await cf(`/ai-gateway/gateways`);
  const gateways = extractGatewayList(list);
  const exists = gateways.some((g) => g && g.id === gatewayId);
  if (exists) {
    console.log(`Gateway «${gatewayId}» ya existe.`);
    return;
  }
  console.log(`Creando gateway «${gatewayId}»…`);
  await cf(`/ai-gateway/gateways`, {
    method: "POST",
    body: JSON.stringify({
      id: gatewayId,
      cache_invalidate_on_update: true,
      cache_ttl: 0,
      collect_logs: true,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0,
      authentication: false,
    }),
  });
  console.log(`Gateway «${gatewayId}» creado.`);
}

async function ensureCustomProvider() {
  const list = await cf(`/ai-gateway/custom-providers?per_page=100`);
  const providers = extractProviderList(list);
  const exists = providers.some((p) => p && p.slug === providerSlug);
  if (exists) {
    console.log(`Custom provider slug «${providerSlug}» ya existe.`);
    return;
  }
  console.log(`Creando custom provider «${providerSlug}» → ${customBaseUrl} …`);
  await cf(`/ai-gateway/custom-providers`, {
    method: "POST",
    body: JSON.stringify({
      name: "GitHub Models (inference)",
      slug: providerSlug,
      base_url: customBaseUrl,
      description: "OpenAI-compatible upstream for ia-agent-worker (GitHub Models).",
      enable: true,
    }),
  });
  console.log(`Custom provider «${providerSlug}» creado.`);
}

try {
  console.log(`Cuenta Cloudflare: ${accountId}`);
  await ensureGateway();
  await ensureCustomProvider();
} catch (e) {
  if (e.status === 403 || e.status === 401) {
    console.error("Token inválido o sin permisos de AI Gateway. Revisa CLOUDFLARE_API_TOKEN.");
  }
  console.error(e.message || e);
  process.exit(1);
}

const compatUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`;

console.log(`
--- Listo ---
Compat URL (referencia): ${compatUrl}

Añade en el Worker (dashboard o wrangler.toml [vars] / [env.preview.vars]):

  AI_GATEWAY_ACCOUNT_ID = ${accountId}
  AI_GATEWAY_ID         = ${gatewayId}
  AI_GATEWAY_PROVIDER_SLUG = ${providerSlug}

Luego: npm run deploy   (o tu pipeline)

Prueba desde el frontend: mismo POST que ya usas contra /api/chat del Worker.
En el dashboard: AI Gateway → el gateway «${gatewayId}» debería mostrar tráfico.
`);
