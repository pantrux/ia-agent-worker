/**
 * Obtiene COPILOT_GITHUB_TOKEN desde el Worker (GET /__internal/copilot-token-recovery-976f) y lo escribe en `.env` en la raíz del repo (gitignored).
 *
 * Variables de entorno (elige una forma):
 * - `COPILOT_TOKEN_RECOVERY_URL`: URL completa con `?k=…`
 * - `WORKER_BASE_URL` + `COPILOT_TOKEN_DUMP_KEY`: el script construye la URL.
 *
 * El valor del token no se muestra por consola.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

const RECOVERY_PATH = "/__internal/copilot-token-recovery-976f";

function buildRecoveryUrl() {
  const full = process.env.COPILOT_TOKEN_RECOVERY_URL?.trim();
  if (full) return full;
  const base = process.env.WORKER_BASE_URL?.trim().replace(/\/$/, "");
  const k = process.env.COPILOT_TOKEN_DUMP_KEY?.trim();
  if (!base || !k) return null;
  const u = new URL(RECOVERY_PATH, base.endsWith("/") ? base : `${base}/`);
  u.searchParams.set("k", k);
  return u.href;
}

function upsertCopilotLine(content, token) {
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    if (line.startsWith("COPILOT_GITHUB_TOKEN=")) {
      replaced = true;
      return `COPILOT_GITHUB_TOKEN=${token}`;
    }
    return line;
  });
  if (!replaced) out.push(`COPILOT_GITHUB_TOKEN=${token}`);
  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

async function main() {
  const url = buildRecoveryUrl();
  if (!url) {
    console.error(
      "Define COPILOT_TOKEN_RECOVERY_URL (URL completa con ?k=…) o bien WORKER_BASE_URL y COPILOT_TOKEN_DUMP_KEY."
    );
    process.exit(1);
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/plain,*/*" },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    console.error(`Petición fallida: HTTP ${res.status}. Comprueba despliegue, ruta y clave k.`);
    process.exit(1);
  }

  const text = (await res.text()).trim();
  const token = text.split(/\r?\n/)[0]?.trim() ?? "";
  if (!token || token.startsWith("{")) {
    console.error("La respuesta no parece un token en texto plano (¿clave k incorrecta o 404 disfrazado?).");
    process.exit(1);
  }

  let content;
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  } else if (fs.existsSync(examplePath)) {
    content = fs.readFileSync(examplePath, "utf8");
  } else {
    content = "COPILOT_GITHUB_TOKEN=\n";
  }

  fs.writeFileSync(envPath, upsertCopilotLine(content, token), "utf8");
  console.log(`COPILOT_GITHUB_TOKEN guardado en ${path.relative(root, envPath)} (valor no mostrado).`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
