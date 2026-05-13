#!/usr/bin/env node
/**
 * Crea (si no existen) un AI Gateway y un custom provider hacia GitHub Models,
 * usando la API v4 de Cloudflare. Idempotente.
 *
 * Requisitos:
 * - CLOUDFLARE_API_TOKEN con permisos «AI Gateway — Edit» (y permiso para listar cuentas, p. ej. «User — User Details — Read» o token de cuenta con «Account — Read»).
 * - CLOUDFLARE_ACCOUNT_ID (opcional: si falta, se obtiene con GET /accounts usando el token, o como último recurso `wrangler whoami --json` vía Node).
 *
 * Opcional: AI_GATEWAY_ID (default: ia-agent-worker-llm),
 *           AI_GATEWAY_PROVIDER_SLUG (default: github-models),
 *           AI_GATEWAY_CUSTOM_BASE_URL (default: https://models.github.ai/inference).
 *
 * Carga opcional: fichero .env.ai-gateway.local (no versionar; ver .env.ai-gateway.example).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const localEnv = resolve(root, ".env.ai-gateway.local");

config({ path: resolve(root, ".env") });

/** Lee .env.ai-gateway.local sin depender solo de config() (BOM, CRLF, orden). */
function mergeEnvLocalFile(absPath) {
  if (!existsSync(absPath)) return false;
  try {
    const raw = readFileSync(absPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      let t = String(v ?? "").trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1).trim();
      }
      if (t) process.env[k] = t;
    }
    return true;
  } catch (e) {
    console.error("Error leyendo", absPath, ":", e.message);
    return false;
  }
}

mergeEnvLocalFile(localEnv);

const API = "https://api.cloudflare.com/client/v4";

const gatewayId = (process.env.AI_GATEWAY_ID || "ia-agent-worker-llm").trim();
const providerSlug = (process.env.AI_GATEWAY_PROVIDER_SLUG || "github-models").trim();
const customBaseUrl = (process.env.AI_GATEWAY_CUSTOM_BASE_URL || "https://models.github.ai/inference").trim();
const token = (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();

if (!token) {
  const localOk = existsSync(localEnv);
  console.error(
    "Falta CLOUDFLARE_API_TOKEN (o CF_API_TOKEN) en el entorno tras cargar variables.\n" +
      `  Fichero buscado: ${localEnv}\n` +
      `  ¿Existe .env.ai-gateway.local? ${localOk ? "sí" : "no"}\n` +
      "Comprueba una línea ASCII, sin comillas tipográficas, por ejemplo:\n" +
      "  CLOUDFLARE_API_TOKEN=tu_token_aqui\n" +
      "Alternativa (PowerShell, solo esta sesión):\n" +
      "  $env:CLOUDFLARE_API_TOKEN=\"...\"\n" +
      "  npm run provision:ai-gateway\n\n" +
      "Crea el token con permiso «Account — AI Gateway — Edit»:\n" +
      "https://dash.cloudflare.com/?to=/:account/api-tokens"
  );
  process.exit(1);
}

/** Lista cuentas accesibles con el API token (evita depender de npx/wrangler en Windows). */
async function accountIdFromCloudflareApi() {
  const res = await fetch(`${API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { id: "", hint: `Respuesta no JSON (${res.status}): ${text.slice(0, 200)}` };
  }
  if (!res.ok || json.success === false) {
    const errMsg = json.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
    return { id: "", hint: `GET /accounts HTTP ${res.status}: ${errMsg}` };
  }
  const list = Array.isArray(json.result) ? json.result : [];
  if (list.length === 0) return { id: "", hint: "GET /accounts devolvió 0 cuentas." };
  if (list.length > 1) {
    console.warn(
      `El token tiene acceso a ${list.length} cuentas; se usa la primera (${list[0].name || list[0].id}). ` +
        "Define CLOUDFLARE_ACCOUNT_ID si no es la correcta."
    );
  }
  const id = list[0]?.id;
  return typeof id === "string" && id.trim() ? { id: id.trim(), hint: "" } : { id: "", hint: "Cuenta sin id en la respuesta." };
}

function wranglerAccountIdFromCli() {
  const wranglerBin = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wranglerBin)) {
    return { id: "", stderr: "No existe node_modules/wrangler (ejecuta npm install en el repo)." };
  }
  const r = spawnSync(process.execPath, [wranglerBin, "whoami", "--json"], {
    cwd: root,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    return {
      id: "",
      stderr: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 600),
    };
  }
  try {
    const j = JSON.parse(r.stdout || "{}");
    const id = j.accounts?.[0]?.id;
    return typeof id === "string" && id.trim() ? { id: id.trim(), stderr: "" } : { id: "", stderr: "whoami sin accounts[0].id" };
  } catch (e) {
    return { id: "", stderr: String(e.message) };
  }
}

async function resolveAccountId() {
  let accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (accountId) return accountId;

  const fromApi = await accountIdFromCloudflareApi();
  if (fromApi.id) return fromApi.id;
  console.warn("No se pudo obtener la cuenta con GET /accounts:", fromApi.hint);

  const fromWrangler = wranglerAccountIdFromCli();
  if (fromWrangler.id) return fromWrangler.id;

  console.error(
    "No se pudo determinar CLOUDFLARE_ACCOUNT_ID.\n" +
      "  1) Define la variable: $env:CLOUDFLARE_ACCOUNT_ID=\"tu_account_id\" (URL del dashboard o Workers Overview).\n" +
      "  2) El API token debe poder listar cuentas: en «Create Custom Token» incluye «Account — Account Settings — Read» o un permiso que permita GET /accounts.\n" +
      "  3) `wrangler whoami` usa el login OAuth de Wrangler (no usa CLOUDFLARE_API_TOKEN); último intento:\n" +
      (fromWrangler.stderr ? fromWrangler.stderr.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 500) : "(sin detalle)")
  );
  process.exit(1);
}

let accountId = await resolveAccountId();

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
