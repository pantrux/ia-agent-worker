#!/usr/bin/env node
/**
 * Lista modelos del catálogo GitHub Models (inferencia).
 * @see https://docs.github.com/en/rest/models/catalog?apiVersion=2026-03-10#list-all-models
 *
 * Token (en este orden):
 * 1. `COPILOT_GITHUB_TOKEN` o `NEW_COPILOT_GITHUB_TOKEN` (tras cargar `.env` / `.env.ai-gateway.local`)
 * 2. Salida de `gh auth token -h github.com`
 *
 * Uso:
 *   npm run list:github-models
 *   npm run list:github-models -- --json
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadRepoEnvFiles } from "./merge-repo-env.mjs";

const root = resolve(import.meta.dirname, "..");
loadRepoEnvFiles(root);

const CATALOG_URL = "https://models.github.ai/catalog/models";
const API_VERSION = "2026-03-10";

function getToken() {
  const fromEnv =
    process.env.COPILOT_GITHUB_TOKEN?.trim() || process.env.NEW_COPILOT_GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const r = spawnSync("gh", ["auth", "token", "-h", "github.com"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (r.status === 0) {
    const t = (r.stdout || "").trim();
    if (t) return t;
  }
  return "";
}

const wantJson = process.argv.includes("--json");

async function main() {
  const token = getToken();
  if (!token) {
    console.error(
      "No hay token. Define COPILOT_GITHUB_TOKEN en `.env` o ejecuta `gh auth login -h github.com`.\n" +
        "  Para GitHub Models hace falta un token con permiso de modelos (p. ej. PAT fine-grained Models → Read)."
    );
    process.exit(1);
  }

  const res = await fetch(CATALOG_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Respuesta no JSON. HTTP", res.status, text.slice(0, 500));
    process.exit(1);
  }

  if (!res.ok) {
    console.error("HTTP", res.status, JSON.stringify(data).slice(0, 800));
    if (res.status === 401 || res.status === 403) {
      console.error(
        "\nSuele faltar alcance de modelos en el token. Crea un PAT con permiso Models (lectura) o revisa la guía de GitHub Models."
      );
    }
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error("Formato inesperado (se esperaba un array de modelos):", typeof data);
    process.exit(1);
  }

  if (wantJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const rows = data
    .map((m) => ({
      id: String(m?.id ?? "").trim(),
      publisher: String(m?.publisher ?? "").trim(),
      name: String(m?.name ?? "").trim(),
    }))
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  console.log(`Modelos en catálogo: ${rows.length}\n`);
  const w = Math.max(8, ...rows.map((r) => r.id.length));
  for (const r of rows) {
    console.log(`${r.id.padEnd(w)}  ${r.publisher || "—"}\t${r.name || ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
