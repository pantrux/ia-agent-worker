/**
 * Sube un secreto a Cloudflare Pages por stdin (evita newline final de PowerShell).
 *
 * Uso habitual (Telegram / BFF / WS), desde ia-agent-worker:
 *   node scripts/put-pages-secret.mjs TELEGRAM_WEBHOOK_SECRET aaas-landing ../aaas-landing/.env
 *   node scripts/put-pages-secret.mjs BFF_API_TOKEN aaas-landing ../aaas-landing/.env
 *
 * Tras cada put: redeploy producción Pages (push main o API deployments branch=main).
 * Luego Telegram: node scripts/set-telegram-webhook.mjs
 *
 * Runbook: aaas-landing/docs/PAN-18-c2-channel-webhooks-design.md § Resincronización de secretos
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const [key, project, envPath] = process.argv.slice(2);
if (!key || !project || !envPath) {
  console.error("usage: node put-pages-secret.mjs <KEY> <project> <path-to-env>");
  process.exit(1);
}

let value = "";
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(new RegExp(`^\\s*${key}\\s*=(.*)$`));
  if (m) value = m[1].trim().replace(/^['"]|['"]$/g, "");
}
if (!value) {
  console.error(`missing ${key}`);
  process.exit(1);
}

const child = spawn(
  "npx",
  ["wrangler", "pages", "secret", "put", key, "--project-name", project],
  { stdio: ["pipe", "inherit", "inherit"], shell: true, cwd: new URL("../../aaas-landing", import.meta.url) }
);
child.stdin.write(value);
child.stdin.end();
child.on("close", (code) => process.exit(code ?? 1));
