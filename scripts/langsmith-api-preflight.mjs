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

/** Cabeceras de respuesta que suelen aparecer en APIs SaaS y ayudan al soporte sin filtrar secretos. */
const DIAGNOSTIC_RESPONSE_HEADERS = new Set([
  "x-request-id",
  "x-correlation-id",
  "cf-ray",
  "cf-cache-status",
  "date",
  "server",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
]);

/**
 * @param {string} label
 * @param {Response} res
 * @param {string} bodyText
 * @param {{ maxBodyChars?: number }} [opts]
 */
function logResponseDiagnostics(label, res, bodyText, opts = {}) {
  const max = opts.maxBodyChars ?? 4000;
  console.error(`\n--- Diagnóstico HTTP: ${label} ---`);
  console.error(`Estado: ${res.status} ${res.statusText || ""}`.trim());
  const picked = [...res.headers.entries()].filter(([k]) => DIAGNOSTIC_RESPONSE_HEADERS.has(k.toLowerCase()));
  if (picked.length) {
    console.error("Cabeceras de respuesta (selección, útiles para soporte LangSmith):");
    for (const [k, v] of picked) console.error(`  ${k}: ${v}`);
  }
  const slice = bodyText.length > max ? `${bodyText.slice(0, max)}… [+${bodyText.length - max} caracteres]` : bodyText;
  console.error(`Cuerpo bruto (hasta ${max} caracteres):\n${slice || "(vacío)"}`);
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      console.error("Cuerpo JSON (claves de primer nivel):");
      for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        if (typeof v === "string") console.error(`  ${k}: ${v.slice(0, 800)}${v.length > 800 ? "…" : ""}`);
        else if (typeof v === "number" || typeof v === "boolean" || v === null) console.error(`  ${k}: ${v}`);
        else if (Array.isArray(v)) console.error(`  ${k}: [array, length=${v.length}]`);
        else if (v && typeof v === "object") console.error(`  ${k}: {object}`);
      }
    }
  } catch {
    /* no es JSON */
  }
}

/**
 * @param {string} base
 * @param {string} pathWithQuery
 * @param {Record<string, string>} headers
 */
async function probeAuthenticatedGET(base, pathWithQuery, headers) {
  const res = await fetch(`${base}${pathWithQuery}`, { headers });
  const text = await res.text();
  return { res, text };
}

async function main() {
  const base = apiBase();
  const apiKey = process.env.LANGSMITH_API_KEY?.trim();
  const tenant = process.env.LANGSMITH_WORKSPACE_ID?.trim();

  console.log("LangSmith API preflight (contrato /api/v1 del OpenAPI)");
  console.log(`  LANGSMITH_ENDPOINT → ${base}`);
  console.log(`  LANGSMITH_WORKSPACE_ID → ${tenant ? "(definido)" : "(omitido)"}`);
  console.log(`  LANGSMITH_API_KEY → ${apiKey ? "(definido, no se imprime)" : "(falta)"}`);

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
    logResponseDiagnostics("GET /api/v1/datasets?limit=1", dsRes, body);
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
      logResponseDiagnostics("GET /api/v1/datasets?limit=1 (sin X-Tenant-Id)", ds2, body2);
    }
  }

  if (!dsRes.ok) {
    console.error("\nSondeo adicional con la misma clave (acierta o falla → acota permisos):");
    const ws = await probeAuthenticatedGET(base, "/api/v1/workspaces", headers);
    console.error(`GET /api/v1/workspaces → ${ws.res.status}`);
    if (!ws.res.ok) {
      logResponseDiagnostics("GET /api/v1/workspaces", ws.res, ws.text, { maxBodyChars: 2500 });
    } else {
      try {
        const list = JSON.parse(ws.text);
        const arr = Array.isArray(list) ? list : [];
        console.error(`  Workspaces visibles con estas cabeceras: ${arr.length}`);
        for (const w of arr.slice(0, 8)) {
          const id = w?.id ?? w?.tenant_id;
          const name = w?.display_name ?? w?.name ?? "";
          if (id) console.error(`  - ${String(id)} ${name ? `(${String(name).slice(0, 80)})` : ""}`);
        }
        if (tenant && arr.length) {
          const match = arr.some((w) => String(w?.id ?? w?.tenant_id ?? "") === tenant);
          console.error(
            match
              ? "  LANGSMITH_WORKSPACE_ID coincide con un workspace devuelto por GET /workspaces."
              : "  LANGSMITH_WORKSPACE_ID no aparece en la lista devuelta por GET /workspaces (revisa el UUID o el workspace activo)."
          );
        }
      } catch {
        logResponseDiagnostics("GET /api/v1/workspaces (respuesta no parseable como lista)", ws.res, ws.text, {
          maxBodyChars: 1500,
        });
      }
    }

    const org = await probeAuthenticatedGET(base, "/api/v1/orgs/current", headers);
    console.error(`GET /api/v1/orgs/current → ${org.res.status}`);
    if (!org.res.ok) {
      logResponseDiagnostics("GET /api/v1/orgs/current", org.res, org.text, { maxBodyChars: 2500 });
    }

    console.error(`
Si sigue 403 Forbidden en /datasets:
  1. Región: LANGSMITH_ENDPOINT alineado con el despliegue del workspace (docs/LANGSMITH-API-CONTRACT.md).
  2. X-Tenant-Id: UUID correcto del workspace (Settings → General); compáralo con la lista de GET /workspaces arriba.
  3. Permisos de la service key: rol con acceso a datasets en ese workspace (403 con {"detail":"Forbidden"} suele ser RBAC/plan).
  4. Incluye en un ticket a LangSmith las cabeceras x-request-id / cf-ray impresas arriba.
OpenAPI: https://api.smith.langchain.com/openapi.json`);
    process.exit(1);
  }

  console.log("\nPreflight OK: la clave puede listar datasets en este host con las cabeceras actuales.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
