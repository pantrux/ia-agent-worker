/**
 * Comprueba host + cabeceras contra el OpenAPI oficial (GET /api/v1/info y GET /api/v1/datasets).
 * Evita depuración a ciegas cuando falla langsmith:dataset:sync con 403.
 *
 * Requiere: LANGSMITH_API_KEY
 * Opcional: LANGSMITH_ENDPOINT, LANGSMITH_WORKSPACE_ID
 */
import "dotenv/config";

function apiBase() {
  const raw = (process.env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com").trim();
  return raw.replace(/\/+$/, "");
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const base = apiBase();
  const apiKey = process.env.LANGSMITH_API_KEY?.trim();
  const tenant = process.env.LANGSMITH_WORKSPACE_ID?.trim();

  console.log("LangSmith API preflight (contrato /api/v1 del OpenAPI)");
  console.log(`  LANGSMITH_ENDPOINT → ${base}`);
  console.log(`  LANGSMITH_WORKSPACE_ID → ${tenant ? "(definido)" : "(omitido)"}`);
  console.log(`  LANGSMITH_API_KEY → ${apiKey ? `${apiKey.slice(0, 10)}…` : "(falta)"}`);

  const infoRes = await fetch(`${base}/api/v1/info`, {
    headers: { Accept: "application/json" },
  });
  console.log(`\nGET /api/v1/info → ${infoRes.status}`);
  if (!infoRes.ok) {
    console.error("No se pudo alcanzar la API en este host. Revisa LANGSMITH_ENDPOINT (EU/APAC/AWS).");
    process.exit(1);
  }

  if (!apiKey) {
    fail("\nDefina LANGSMITH_API_KEY. Ver docs/LANGSMITH-API-CONTRACT.md");
  }

  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/json",
    "X-Api-Key": apiKey,
  };
  if (tenant) {
    headers["X-Tenant-Id"] = tenant;
  }

  const dsRes = await fetch(`${base}/api/v1/datasets?limit=1`, { headers });
  const body = await dsRes.text();
  console.log(`GET /api/v1/datasets?limit=1 → ${dsRes.status}`);
  if (!dsRes.ok) {
    console.error(body.slice(0, 800));
    console.error(`
Si ves 403 Forbidden:
  1. Región: cuenta en EU/APAC/AWS → LANGSMITH_ENDPOINT debe ser el host de esa región (docs/LANGSMITH-API-CONTRACT.md).
  2. X-Tenant-Id: service keys multi-workspace → LANGSMITH_WORKSPACE_ID = UUID del workspace en Settings (no del proyecto).
  3. Permisos: en LangSmith, rol de la service key con acceso a datasets en ese workspace.
Ver: https://api.smith.langchain.com/openapi.json (securitySchemes: X-Api-Key, X-Tenant-Id).`);
    process.exit(1);
  }

  console.log("\nPreflight OK: la clave puede listar datasets en este host con las cabeceras actuales.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
