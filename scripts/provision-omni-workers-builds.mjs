/**
 * Conecta pantrux/omni-channel-worker a Workers Builds (prod + preview workers).
 * Requiere user API token con Workers Builds Configuration (Edit) + Workers Scripts (Read).
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "8a31ec012e21b8f414288de35697c564";
const GITHUB_OWNER = "pantrux";
const GITHUB_OWNER_ID = "115902937";
const GITHUB_REPO = "omni-channel-worker";
const GITHUB_REPO_ID = "1249959503";

function readWranglerOAuthToken() {
  const candidates = [
    join(homedir(), "AppData", "Roaming", "xdg.config", ".wrangler", "config", "default.toml"),
    join(homedir(), ".config", ".wrangler", "config", "default.toml")
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const match = readFileSync(path, "utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m);
    if (match?.[1]) return match[1];
  }
  return null;
}

function getApiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() || readWranglerOAuthToken();
  if (!token) {
    throw new Error("Define CLOUDFLARE_API_TOKEN (user token con Workers Builds Configuration Edit).");
  }
  return token;
}

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
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

async function getWorkerTag(workerName) {
  const scripts = await cf(`/accounts/${ACCOUNT_ID}/workers/scripts`);
  const hit = scripts.find((s) => s.id === workerName);
  if (!hit?.tag) throw new Error(`Worker no encontrado: ${workerName}`);
  return hit.tag;
}

async function listTriggers(workerTag) {
  try {
    return await cf(`/accounts/${ACCOUNT_ID}/builds/workers/${workerTag}/triggers`);
  } catch (err) {
    if (String(err.message).includes("Resource not found")) return [];
    throw err;
  }
}

async function upsertRepoConnection() {
  const result = await cf(`/accounts/${ACCOUNT_ID}/builds/repos/connections`, {
    method: "PUT",
    body: {
      provider_type: "github",
      provider_account_id: GITHUB_OWNER_ID,
      provider_account_name: GITHUB_OWNER,
      repo_id: GITHUB_REPO_ID,
      repo_name: GITHUB_REPO
    }
  });
  return result.repo_connection_uuid;
}

async function getBuildTokenUuid() {
  const tokens = await cf(`/accounts/${ACCOUNT_ID}/builds/tokens`);
  if (!tokens.length) {
    throw new Error("No hay build tokens. Conecta un Worker en Dashboard → Settings → Builds (crea token automático).");
  }
  const preferred = tokens.find((t) => /omni|worker|default/i.test(t.build_token_name || ""));
  return (preferred || tokens[0]).build_token_uuid;
}

async function createTrigger({ workerTag, repoConnectionUuid, buildTokenUuid, triggerName, branchIncludes, branchExcludes, buildCommand, deployCommand }) {
  return cf(`/accounts/${ACCOUNT_ID}/builds/triggers`, {
    method: "POST",
    body: {
      external_script_id: workerTag,
      repo_connection_uuid: repoConnectionUuid,
      build_token_uuid: buildTokenUuid,
      trigger_name: triggerName,
      build_command: buildCommand,
      deploy_command: deployCommand,
      root_directory: "/",
      branch_includes: branchIncludes,
      branch_excludes: branchExcludes,
      path_includes: ["*"],
      path_excludes: [],
      build_caching_enabled: true
    }
  });
}

async function triggerBuild(triggerUuid, branch) {
  return cf(`/accounts/${ACCOUNT_ID}/builds/triggers/${triggerUuid}/builds`, {
    method: "POST",
    body: { branch }
  });
}

async function ensureTrigger({ workerName, workerTag, existing, repoConnectionUuid, buildTokenUuid, config }) {
  const hasMatching = existing.some(
    (t) =>
      JSON.stringify(t.branch_includes || []) === JSON.stringify(config.branchIncludes) &&
      (t.deploy_command || "").includes(config.deployCommand.split(" ")[0])
  );
  if (hasMatching) {
    console.log(`OK: trigger ya existe para ${workerName} (${config.triggerName})`);
    return existing.find((t) => JSON.stringify(t.branch_includes || []) === JSON.stringify(config.branchIncludes));
  }
  const created = await createTrigger({
    workerTag,
    repoConnectionUuid,
    buildTokenUuid,
    ...config
  });
  console.log(`OK: trigger creado para ${workerName} (${config.triggerName})`);
  return created;
}

async function main() {
  const prodTag = await getWorkerTag("omni-channel-worker");
  const previewTag = await getWorkerTag("omni-channel-worker-preview");

  const [prodTriggers, previewTriggers] = await Promise.all([
    listTriggers(prodTag),
    listTriggers(previewTag)
  ]);

  if (prodTriggers.length && previewTriggers.length) {
    console.log("Workers Builds ya configurado para omni-channel-worker (prod + preview).");
    for (const t of [...prodTriggers, ...previewTriggers]) {
      console.log(`- ${t.trigger_name}: branches=${JSON.stringify(t.branch_includes)} deploy=${t.deploy_command}`);
    }
    return;
  }

  const repoConnectionUuid = await upsertRepoConnection();
  const buildTokenUuid = await getBuildTokenUuid();

  const prodTrigger = await ensureTrigger({
    workerName: "omni-channel-worker",
    workerTag: prodTag,
    existing: prodTriggers,
    repoConnectionUuid,
    buildTokenUuid,
    config: {
      triggerName: "Deploy production (main)",
      branchIncludes: ["main"],
      branchExcludes: [],
      buildCommand: "npm ci && npm run check",
      deployCommand: "npm run deploy"
    }
  });

  await ensureTrigger({
    workerName: "omni-channel-worker-preview",
    workerTag: previewTag,
    existing: previewTriggers,
    repoConnectionUuid,
    buildTokenUuid,
    config: {
      triggerName: "Deploy preview branches",
      branchIncludes: ["*"],
      branchExcludes: ["main"],
      buildCommand: "npm ci && npm run check",
      deployCommand: "npx wrangler deploy --env preview"
    }
  });

  if (prodTrigger?.trigger_uuid) {
    const build = await triggerBuild(prodTrigger.trigger_uuid, "main");
    console.log(`Build inicial disparado: ${build.build_uuid}`);
  }

  console.log("Workers Builds conectado a pantrux/omni-channel-worker.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
