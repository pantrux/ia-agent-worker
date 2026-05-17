/** Escribe un secreto en Worker sin newline final (evita desajuste HMAC con Pages). */
import { spawn } from "node:child_process";
import fs from "node:fs";

const [key, envPath, wranglerEnv] = process.argv.slice(2);
if (!key || !envPath) {
  console.error("usage: node put-worker-secret.mjs <KEY> <path-to-env> [wrangler-env]");
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

const args = ["wrangler", "secret", "put", key];
if (wranglerEnv) args.push("--env", wranglerEnv);

const child = spawn("npx", args, {
  stdio: ["pipe", "inherit", "inherit"],
  shell: true,
  cwd: new URL("..", import.meta.url),
});
child.stdin.write(value);
child.stdin.end();
child.on("close", (code) => process.exit(code ?? 1));
