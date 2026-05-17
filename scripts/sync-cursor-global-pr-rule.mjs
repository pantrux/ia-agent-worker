#!/usr/bin/env node
/**
 * @deprecated Usar sync-cursor-global-rules.mjs (npm run sync:cursor-global-rules).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "sync-cursor-global-rules.mjs");
const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
if (result.error) {
  console.error("Error al lanzar sync-cursor-global-rules.mjs:", result.error.message);
}
process.exit(result.status ?? 1);
