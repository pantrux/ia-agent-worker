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
  let body = await dsRes.text();
  console.log(`GET /api/v1/datasets?limit=1 → ${dsRes.status}`);
  if (!dsRes.ok) {
    console.error("Cuerpo de respuesta:", body.slice(0, 1200));
  }

  if (dsRes.status === 403 && tenant) {
    console.log("\nReintento sin cabecera X-Tenant-Id (diagnóstico)…");
    const headersNoTenant = {
      Accept: "application/json",
      "X-Api-Key": apiKey,
    };
    const ds2 = await fetch(`${base}/api/v1/datasets?limit=1`, { headers: headersNoTenant });
    const body2 = await ds2.text();
    console.log(`GET /api/v1/datasets?limit=1 (sin tenant) → ${ds2.status}`);
    if (ds2.ok) {
      console.error(
        "\n→ Con X-Tenant-Id falla (403) pero sin tenant funciona: revisa LANGSMITH_WORKSPACE_ID (debe ser el UUID del workspace en Settings, no de un proyecto)."
      );
    } else {
      console.error("Cuerpo (sin tenant):", body2.slice(0, 800));
    }
  }

  if (!dsRes.ok) {
    console.error(`
Si sigue 403 Forbidden:
  1. Región: LANGSMITH_ENDPOINT alineado con el despliegue del workspace (docs/LANGSMITH-API-CONTRACT.md).
  2. X-Tenant-Id: UUID correcto del workspace (Settings → General).
  3. Permisos de la service key: rol con acceso a datasets en ese workspace.
OpenAPI: https://api.smith.langchain.com/openapi.json`);
    process.exit(1);
  }

  console.log("\nPreflight OK: la clave puede listar datasets en este host con las cabeceras actuales.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
