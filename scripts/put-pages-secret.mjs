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
