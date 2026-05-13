import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Load `.env` from repo root regardless of `process.cwd()` (LangGraph CLI spawns workers from varied cwd). */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
config({ path: join(repoRoot, ".env") });
