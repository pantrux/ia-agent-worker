/**
 * Rota el secreto COPILOT_GITHUB_TOKEN en el Worker (producción + preview).
 *
 * Origen del valor (en este orden):
 * 1. Variable de entorno NEW_COPILOT_GITHUB_TOKEN (PAT u otro token que quieras subir).
 * 2. Salida de `gh auth token -h github.com` (sesión GitHub CLI).
 *
 * Tras un OK de Wrangler, escribe una copia temporal en `.copilot-token-rotation-once.txt`
 * (gitignored) para que puedas pegarla en `.env`, `.dev.vars` y Secrets de Cursor Cloud Agent;
 * luego borra ese fichero.
 *
 * Requiere: wrangler autenticado (OAuth o API token con permisos Workers).
 */
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outFile = resolve(root, ".copilot-token-rotation-once.txt");
const wranglerJs = resolve(root, "node_modules/wrangler/bin/wrangler.js");

function getToken() {
  const fromEnv = process.env.NEW_COPILOT_GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const r = spawnSync("gh", ["auth", "token", "-h", "github.com"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (r.status === 0) {
    const t = (r.stdout || "").trim();
    if (t) return t;
  }
  return null;
}

function putWrangler(name, token, extraArgs) {
  const exe = process.execPath;
  const args = [wranglerJs, "secret", "put", name, ...extraArgs];
  return spawnSync(exe, args, {
    cwd: root,
    input: token + "\n",
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

if (!existsSync(wranglerJs)) {
  console.error("Ejecuta npm install en la raíz del repo.");
  process.exit(1);
}

const token = getToken();
if (!token) {
  console.error(`No se obtuvo token para COPILOT_GITHUB_TOKEN.

Opciones:
  • GitHub CLI: ejecuta "gh auth login -h github.com" y vuelve a lanzar este script.
  • PAT u otro token: en la misma consola,
    PowerShell:  $env:NEW_COPILOT_GITHUB_TOKEN="ghp_…"; npm run rotate:copilot-github-token
    bash:        NEW_COPILOT_GITHUB_TOKEN='ghp_…' npm run rotate:copilot-github-token
`);
  process.exit(1);
}

const prod = putWrangler("COPILOT_GITHUB_TOKEN", token, []);
if (prod.status !== 0) {
  console.error("wrangler secret put COPILOT_GITHUB_TOKEN (prod) falló:\n", prod.stderr || prod.stdout);
  process.exit(1);
}
console.log("OK: COPILOT_GITHUB_TOKEN en Worker producción.");

const prev = putWrangler("COPILOT_GITHUB_TOKEN", token, ["--env", "preview"]);
if (prev.status !== 0) {
  console.error(
    "wrangler secret put COPILOT_GITHUB_TOKEN --env preview falló:\n",
    prev.stderr || prev.stdout,
    "\nNota: producción ya pudo quedar con el token nuevo; al corregir preview, reintenta con el mismo valor o alinea el secreto en el panel de Cloudflare.\n"
  );
  process.exit(1);
}
console.log("OK: COPILOT_GITHUB_TOKEN en Worker preview.");

try {
  if (existsSync(outFile)) unlinkSync(outFile);
} catch {
  // ignorar
}
writeFileSync(outFile, token, "utf8");

console.error(
  "\n[Seguridad] El token quedó en texto plano en .copilot-token-rotation-once.txt (gitignored). " +
    "Borra ese archivo en cuanto copies el valor a .env / .dev.vars / Cursor; si interrumpes el script, revisa que no quede una copia antigua.\n"
);

console.log(`
Copia local: el mismo valor está en .copilot-token-rotation-once.txt (gitignored).
Actualiza .env, .dev.vars y los Secrets de Cursor Cloud Agent con ese valor, y borra el fichero.
No pegues el token en chats públicos ni lo subas a git.
`);
