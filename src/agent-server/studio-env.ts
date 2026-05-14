import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import type { Env } from "../env.js";
import { DEFAULT_COPILOT_MODEL } from "../llm-client.js";
import { wrapSqlJsAsCrmDatabase } from "../db/sqljs-crm-db.js";

const studioDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(studioDir, "..", "..");

export async function loadStudioEnv(): Promise<Env> {
  const schema = readFileSync(join(repoRoot, "schema.sql"), "utf-8");
  const seed = readFileSync(join(repoRoot, "seed.sql"), "utf-8");

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(schema);
  db.exec(seed);

  const token = process.env.COPILOT_GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "COPILOT_GITHUB_TOKEN is required for LangGraph Studio. Copy .env.example to .env and set your token."
    );
  }

  return {
    DB: wrapSqlJsAsCrmDatabase(db),
    COPILOT_GITHUB_TOKEN: token,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "http://localhost:3000",
    COPILOT_MODEL: process.env.COPILOT_MODEL ?? DEFAULT_COPILOT_MODEL,
    OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? "https://models.github.ai/inference",
    LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
    LANGSMITH_TRACING: process.env.LANGSMITH_TRACING,
    LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT,
    LANGCHAIN_CALLBACKS_BACKGROUND: process.env.LANGCHAIN_CALLBACKS_BACKGROUND,
    AI_GATEWAY_ACCOUNT_ID: process.env.AI_GATEWAY_ACCOUNT_ID,
    AI_GATEWAY_ID: process.env.AI_GATEWAY_ID,
    AI_GATEWAY_API_TOKEN: process.env.AI_GATEWAY_API_TOKEN,
    AI_GATEWAY_PROVIDER_SLUG: process.env.AI_GATEWAY_PROVIDER_SLUG,
    AI_GATEWAY_PROVIDER_PATH: process.env.AI_GATEWAY_PROVIDER_PATH,
  };
}

/** @internal */
export function getStudioRepoRoot(): string {
  return repoRoot;
}
