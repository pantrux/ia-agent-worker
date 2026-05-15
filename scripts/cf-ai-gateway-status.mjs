#!/usr/bin/env node
/**
 * Lista gateways y custom providers del AI Gateway (API v4).
 * Usa **CF_AI_GATEWAY_API_TOKEN** (recomendado) o `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` desde **.env** o **.env.ai-gateway.local**.
 *
 * Exit: 0 si existen el gateway `AI_GATEWAY_ID` y el slug `AI_GATEWAY_PROVIDER_SLUG`; 1 si falta alguno; 2 sin token.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadRepoEnvFiles, warnIfCloudflareApiTokenEmpty } from "./merge-repo-env.mjs";

const root = resolve(import.meta.dirname, "..");
const rootEnv = resolve(root, ".env");
const localEnv = resolve(root, ".env.ai-gateway.local");

loadRepoEnvFiles(root);
warnIfCloudflareApiTokenEmpty(root);

const API = "https://api.cloudflare.com/client/v4";
const token = (process.env.CF_AI_GATEWAY_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();
const gatewayId = (process.env.AI_GATEWAY_ID || "ia-agent-worker-llm").trim();
const providerSlug =
  (process.env.AI_GATEWAY_PROVIDER_SLUG || "github-copilot-enterprise")
    .trim()
    .replace(/^custom-/, "")
    .trim() || "github-copilot-enterprise";

if (!token) {
  console.error(
    "Falta CF_AI_GATEWAY_API_TOKEN (recomendado) o CLOUDFLARE_API_TOKEN / CF_API_TOKEN.\n" +
      "  Pon **CF_AI_GATEWAY_API_TOKEN** en `.env` (token solo AI Gateway) para no chocar con `wrangler deploy`.\n" +
      `  ¿Existe .env? ${existsSync(rootEnv) ? "sí" : "no"}  |  ¿Existe .env.ai-gateway.local? ${existsSync(localEnv) ? "sí" : "no"}\n` +
      "  Permisos: Account → AI Gateway → Edit; conviene Account → Read para listar cuentas.\n" +
      "  Tras guardar: npm run provision:ai-gateway   o   workflow «Provision AI Gateway» en GitHub Actions (secret CLOUDFLARE_API_TOKEN → CF_AI_GATEWAY_API_TOKEN)."
  );
  process.exit(2);
}

async function accountIdFromApi() {
  const res = await fetch(`${API}/accounts`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    console.error("GET /accounts:", res.status, JSON.stringify(json.errors || json).slice(0, 400));
    process.exit(1);
  }
  const list = Array.isArray(json.result) ? json.result : [];
  const id = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim() || list[0]?.id;
  if (!id) {
    console.error("Sin CLOUDFLARE_ACCOUNT_ID y GET /accounts sin cuentas.");
    process.exit(1);
  }
  return id;
}

function extractList(body, keys) {
  const r = body.result;
  if (Array.isArray(r)) return r;
  for (const k of keys) {
    if (Array.isArray(r?.[k])) return r[k];
  }
  return [];
}

async function cf(accountId, path) {
  const url = `${API}/accounts/${accountId}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.success === false) {
    console.error(`HTTP ${res.status} ${path}:`, text.slice(0, 500));
    process.exit(1);
  }
  return json;
}

const accountId = await accountIdFromApi();
console.log(`Cuenta: ${accountId}\n`);

const gwBody = await cf(accountId, "/ai-gateway/gateways");
const gateways = extractList(gwBody, ["gateways", "data"]);
const gwIds = gateways.map((g) => g?.id).filter(Boolean);
console.log(`Gateways (${gwIds.length}):`, gwIds.length ? gwIds.join(", ") : "(ninguno)");
const gwOk = gateways.some((g) => g && g.id === gatewayId);
console.log(`  ¿«${gatewayId}» existe? ${gwOk ? "sí" : "NO"}\n`);

const prBody = await cf(accountId, "/ai-gateway/custom-providers?per_page=100");
const providers = extractList(prBody, ["providers", "data"]);
const slugs = providers.map((p) => p?.slug).filter(Boolean);
console.log(`Custom providers (${slugs.length}):`, slugs.length ? slugs.join(", ") : "(ninguno)");
const slugOk = providers.some((p) => p && p.slug === providerSlug);
console.log(`  ¿slug «${providerSlug}» existe? ${slugOk ? "sí" : "NO"}\n`);

if (!gwOk || !slugOk) {
  console.error(
      "Acción: ejecuta en local `npm run provision:ai-gateway` (con **CF_AI_GATEWAY_API_TOKEN** o token compatible) o el workflow «Provision AI Gateway» en GitHub (secret CLOUDFLARE_API_TOKEN)."
  );
  process.exit(1);
}

console.log("Estado: gateway y custom provider alineados con wrangler.toml.");
process.exit(0);
