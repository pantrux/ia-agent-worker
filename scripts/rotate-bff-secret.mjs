/**
 * Rota BFF_API_TOKEN en Worker (prod + preview) y WORKER_SMOKE_BFF_TOKEN en GitHub.
 * Requiere: wrangler autenticado (OAuth o token con Workers) y `gh` con acceso al repo.
 *
 * El valor nuevo queda en `.bff-rotation-once.txt` (gitignore). Léelo, úsalo donde haga
 * falta y borra el fichero.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outFile = resolve(root, ".bff-rotation-once.txt");
const token = randomBytes(32).toString("base64url");

function putWrangler(extraArgs) {
  const wranglerJs = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  const exe = process.execPath;
  const args = [wranglerJs, "secret", "put", "BFF_API_TOKEN", ...extraArgs];
  const r = spawnSync(exe, args, {
    cwd: root,
    input: token + "\n",
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return { status: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
}

function putGhSecret() {
  const r = spawnSync("gh", ["secret", "set", "WORKER_SMOKE_BFF_TOKEN", "--repo", "pantrux/ia-agent-worker"], {
    cwd: root,
    input: token,
    encoding: "utf8",
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { status: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
}

if (!existsSync(resolve(root, "node_modules/wrangler/bin/wrangler.js"))) {
  console.error("Ejecuta npm install en la raíz del repo.");
  process.exit(1);
}

writeFileSync(outFile, token, "utf8");
console.log("Token generado. Escrito en .bff-rotation-once.txt (no versionar).");

const prod = putWrangler([]);
if (prod.status !== 0) {
  console.error("wrangler secret put BFF_API_TOKEN (prod) falló:\n", prod.stderr || prod.stdout);
  process.exit(1);
}
console.log("OK: BFF_API_TOKEN en Worker producción.");

const prev = putWrangler(["--env", "preview"]);
if (prev.status !== 0) {
  console.error("wrangler secret put BFF_API_TOKEN --env preview falló:\n", prev.stderr || prev.stdout);
  process.exit(1);
}
console.log("OK: BFF_API_TOKEN en Worker preview.");

const gh = putGhSecret();
if (gh.status !== 0) {
  console.warn("gh secret set falló (¿gh auth login?). Actualiza WORKER_SMOKE_BFF_TOKEN a mano con el valor del fichero.\n", gh.stderr || gh.stdout);
} else {
  console.log("OK: WORKER_SMOKE_BFF_TOKEN en GitHub Actions.");
}

console.log(`
Siguiente paso: abre .bff-rotation-once.txt, copia el valor si tu frontend u otra herramienta lo necesita, y borra el fichero.
No pegues el token en chats públicos.
`);
