/**
 * Crea un user API token de Cloudflare con permisos para Workers Builds + deploy Wrangler.
 * Requiere CLOUDFLARE_GLOBAL_API_KEY + CLOUDFLARE_EMAIL (Global API Key del perfil CF).
 * Guarda el token en `.env` de omni-channel-worker e ia-agent-worker y opcionalmente en GitHub Actions.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iaRoot = resolve(__dirname, "..");
const omniRoot = resolve(iaRoot, "..", "omni-channel-worker");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "8a31ec012e21b8f414288de35697c564";
const email = process.env.CLOUDFLARE_EMAIL?.trim();
const globalKey = process.env.CLOUDFLARE_GLOBAL_API_KEY?.trim();

if (!email || !globalKey) {
  console.error(
    "Define CLOUDFLARE_EMAIL y CLOUDFLARE_GLOBAL_API_KEY (Global API Key en dash.cloudflare.com/profile/api-tokens)."
  );
  process.exit(1);
}

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      "X-Auth-Email": email,
      "X-Auth-Key": globalKey,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`${method} ${path} → ${msg}`);
  }
  return json.result;
}

async function findPermissionGroupId(name) {
  const groups = await cf(`/user/tokens/permission_groups?per_page=1000`);
  const hit = groups.find((g) => g.name === name);
  if (!hit?.id) throw new Error(`Permission group no encontrado: ${name}`);
  return hit.id;
}

function upsertEnvToken(filePath, token) {
  const block = `# --- CLOUDFLARE_API_TOKEN ---
# Para qué: deploy Wrangler y configuración Workers Builds (CI/CD Cloudflare + GitHub Actions).
# Dónde: GitHub Actions \`deploy.yml\` / \`provision-workers-builds.yml\`; script \`provision-omni-workers-builds.mjs\`.
# Riesgo al rotar: deja de funcionar deploy automático y provisión Builds hasta actualizar el secret en GitHub.
CLOUDFLARE_API_TOKEN=${token}`;
  let content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const re = /# --- CLOUDFLARE_API_TOKEN ---[\s\S]*?(?=\n# ---|$)/m;
  if (re.test(content)) content = content.replace(re, `${block.trimEnd()}\n\n`);
  else content = `${content.trimEnd() ? `${content.trimEnd()}\n\n` : ""}${block}\n`;
  writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

async function main() {
  const [buildsEdit, scriptsRead, scriptsWrite, aiGatewayEdit] = await Promise.all([
    findPermissionGroupId("Workers Builds Configuration"),
    findPermissionGroupId("Workers Scripts Read"),
    findPermissionGroupId("Workers Scripts Write"),
    findPermissionGroupId("AI Gateway Edit")
  ]);

  const tokenName = `omni-workers-cicd-${new Date().toISOString().slice(0, 10)}`;
  const created = await cf("/user/tokens", {
    method: "POST",
    body: {
      name: tokenName,
      policies: [
        {
          effect: "allow",
          permission_groups: [
            { id: buildsEdit },
            { id: scriptsRead },
            { id: scriptsWrite },
            { id: aiGatewayEdit }
          ],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*"
          }
        }
      ]
    }
  });

  const value = created.value;
  if (!value) throw new Error("Cloudflare no devolvió el valor del token (solo visible al crear).");

  upsertEnvToken(resolve(omniRoot, ".env"), value);
  upsertEnvToken(resolve(iaRoot, ".env"), value);

  for (const repo of ["pantrux/omni-channel-worker", "pantrux/ia-agent-worker"]) {
    const r = spawnSync("gh", ["secret", "set", "CLOUDFLARE_API_TOKEN", "--repo", repo], {
      input: `${value}\n`,
      encoding: "utf8"
    });
    if (r.status !== 0) {
      console.error(`gh secret set falló (${repo}):`, r.stderr || r.stdout);
      process.exit(1);
    }
    console.log(`OK: secret CLOUDFLARE_API_TOKEN en ${repo}`);
  }

  for (const repo of ["pantrux/omni-channel-worker"]) {
    const r = spawnSync(
      "gh",
      ["variable", "set", "CLOUDFLARE_ACCOUNT_ID", "--repo", repo, "--body", accountId],
      { encoding: "utf8" }
    );
    if (r.status !== 0) {
      console.error(`gh variable set falló (${repo}):`, r.stderr || r.stdout);
      process.exit(1);
    }
    console.log(`OK: variable CLOUDFLARE_ACCOUNT_ID en ${repo}`);
  }

  console.log(`Token creado (${tokenName}). Ejecuta: node scripts/provision-omni-workers-builds.mjs`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
