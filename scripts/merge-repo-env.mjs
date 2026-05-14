/**
 * Carga variables no vacías desde `.env` y `.env.ai-gateway.local` en la raíz del repo.
 * Orden: primero `.env`, luego `.env.ai-gateway.local` (este último gana en duplicados).
 * No versionar esos ficheros (están en `.gitignore`).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

/** @param {string} absPath */
export function mergeEnvFile(absPath) {
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

/** @param {string} rootDir */
export function loadRepoEnvFiles(rootDir) {
  mergeEnvFile(resolve(rootDir, ".env"));
  mergeEnvFile(resolve(rootDir, ".env.ai-gateway.local"));
}

/**
 * Avisa si tokens de API Cloudflare están definidos pero vacíos (error típico al copiar plantillas).
 * @param {string} rootDir
 */
export function warnIfCloudflareApiTokenEmpty(rootDir) {
  for (const name of [".env", ".env.ai-gateway.local"]) {
    const p = resolve(rootDir, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8").replace(/^\uFEFF/, "");
      const parsed = parse(raw);
      for (const key of ["CF_AI_GATEWAY_API_TOKEN", "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"]) {
        if (parsed[key] !== undefined && String(parsed[key]).trim() === "") {
          console.error(
            `${key} aparece vacío en ${name}. Pon el valor del panel de Cloudflare o elimina la línea.`
          );
        }
      }
    } catch {
      /* ignore */
    }
  }
}
