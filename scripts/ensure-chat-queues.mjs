/**
 * Crea las colas de PAN-17 si aún no existen (idempotente).
 * Pensado para Workers Builds / CI: ejecutar antes de `wrangler versions upload` o `wrangler deploy`.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const queues = ["ia-agent-chat-queue", "ia-agent-chat-queue-preview"];

for (const q of queues) {
  const r = spawnSync("npx", ["wrangler", "queues", "create", q], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    console.warn(`[ensure-chat-queues] wrangler queues create ${q} → código ${r.status} (omitido si la cola ya existe).`);
  }
}
