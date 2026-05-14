#!/usr/bin/env node
/**
 * Crea (si no existen) un AI Gateway y un custom provider hacia GitHub Models,
 * usando la API v4 de Cloudflare. Idempotente.
 *
 * Requisitos:
 * - **CF_AI_GATEWAY_API_TOKEN** (recomendado) o `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`: permisos «AI Gateway — Edit» (y listar cuentas). Usa `CF_AI_GATEWAY_API_TOKEN` en `.env` para no interferir con `wrangler deploy` (Wrangler también lee `CLOUDFLARE_API_TOKEN`).
 * - CLOUDFLARE_ACCOUNT_ID (opcional: si falta, se obtiene con GET /accounts usando el token, o como último recurso `wrangler whoami --json` vía Node).
 *
 * Opcional: AI_GATEWAY_ID (default: ia-agent-worker-llm),
 *           AI_GATEWAY_PROVIDER_SLUG (default: github-models),
 *           AI_GATEWAY_CUSTOM_BASE_URL (default: https://models.github.ai) — solo el host; el Worker
 *           usa la ruta del gateway `…/custom-{slug}/inference/chat/completions` y Cloudflare concatena
 *           con este base_url (ver docs «provider-specific»). No uses …/inference aquí o duplicará el segmento.
 *
 * Carga opcional: raíz del repo — `.env` y `.env.ai-gateway.local` (no versionar; ver `.env.example` y `.env.ai-gateway.example`).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadRepoEnvFiles, warnIfCloudflareApiTokenEmpty } from "./merge-repo-env.mjs";

const root = resolve(import.meta.dirname, "..");
const localEnv = resolve(root, ".env.ai-gateway.local");
const rootEnv = resolve(root, ".env");

loadRepoEnvFiles(root);
warnIfCloudflareApiTokenEmpty(root);

const API = "https://api.cloudflare.com/client/v4";

const gatewayId = (process.env.AI_GATEWAY_ID || "ia-agent-worker-llm").trim();
const providerSlug =
  (process.env.AI_GATEWAY_PROVIDER_SLUG || "github-models").trim().replace(/^custom-/, "").trim() || "github-models";
const customBaseUrl = (process.env.AI_GATEWAY_CUSTOM_BASE_URL || "https://models.github.ai").trim();
const token = (process.env.CF_AI_GATEWAY_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();

if (!token) {
  const hasRoot = existsSync(rootEnv);
  const hasGw = existsSync(localEnv);
  console.error(
    "Falta CF_AI_GATEWAY_API_TOKEN (recomendado) o CLOUDFLARE_API_TOKEN / CF_API_TOKEN tras cargar `.env`.\n" +
      "  Define **CF_AI_GATEWAY_API_TOKEN** en `.env` con el token solo de AI Gateway; evita `CLOUDFLARE_API_TOKEN` en `.env` si usas `wrangler deploy` con OAuth (Wrangler tomaría ese token y fallaría sin permiso Workers).\n" +
      `  ¿Existe .env? ${hasRoot ? "sí" : "no"}  |  ¿Existe .env.ai-gateway.local? ${hasGw ? "sí" : "no"}\n` +
      "  Crear token: https://dash.cloudflare.com/?to=/:account/api-tokens\n" +
      "Alternativa (PowerShell, solo esta sesión):\n" +
      "  $env:CF_AI_GATEWAY_API_TOKEN=\"...\"\n" +
      "  npm run provision:ai-gateway\n\n"
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
  const desired = customBaseUrl.replace(/\/+$/, "");
  const existing = providers.find((p) => p && p.slug === providerSlug);
  if (existing) {
    const current = String(existing.base_url ?? "")
      .trim()
      .replace(/\/+$/, "");
    if (current === desired) {
      console.log(`Custom provider «${providerSlug}» ya existe (base_url OK).`);
      return;
    }
    const id = existing.id;
    if (!id) {
      console.warn(`Custom provider «${providerSlug}» existe pero sin id en API; no se puede PATCH. Revisa el dashboard.`);
      return;
    }
    console.log(`Actualizando base_url de «${providerSlug}»: ${current || "(vacío)"} → ${desired}`);
    await cf(`/ai-gateway/custom-providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: existing.name ?? "GitHub Models (inference)",
        slug: existing.slug ?? providerSlug,
        base_url: desired,
        description:
          existing.description ?? "OpenAI-compatible upstream for ia-agent-worker (GitHub Models).",
        enable: existing.enable !== false,
      }),
    });
    console.log(`Custom provider «${providerSlug}» actualizado.`);
    return;
  }
  console.log(`Creando custom provider «${providerSlug}» → ${customBaseUrl} …`);
  await cf(`/ai-gateway/custom-providers`, {
    method: "POST",
    body: JSON.stringify({
      name: "GitHub Models (inference)",
      slug: providerSlug,
      base_url: desired,
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
    console.error("Token inválido o sin permisos de AI Gateway. Revisa CF_AI_GATEWAY_API_TOKEN o CLOUDFLARE_API_TOKEN.");
  }
  console.error(e.message || e);
  process.exit(1);
}

const compatUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`;
const customBase = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/custom-${providerSlug}`;

console.log(`
--- Listo ---
Compat URL (sin AI_GATEWAY_PROVIDER_SLUG): ${compatUrl}
Custom provider base (con AI_GATEWAY_PROVIDER_SLUG=${providerSlug}): ${customBase}

Añade en el Worker (dashboard o wrangler.toml [vars] / [env.preview.vars]):

  AI_GATEWAY_ACCOUNT_ID = ${accountId}
  AI_GATEWAY_ID         = ${gatewayId}
  AI_GATEWAY_PROVIDER_SLUG = ${providerSlug}
  # Opcional (GitHub Models): AI_GATEWAY_PROVIDER_PATH = inference

Con slug, el Worker usa la URL del gateway \`…/custom-{slug}/{path}\` (por defecto \`path=inference\`; OpenAI SDK añade \`/chat/completions\`).
El custom provider en Cloudflare debe tener base_url = host \`https://models.github.ai\` (sin \`/inference\`; si quedó la URL antigua, este script la corrige con PATCH).

Luego: npm run deploy   (o tu pipeline)

Prueba desde el frontend: mismo POST que ya usas contra /api/chat del Worker.
En el dashboard: AI Gateway → el gateway «${gatewayId}» debería mostrar tráfico.
`);
