import type { CrmDatabase } from "./db/crm-db.js";

export interface Env {
  DB: CrmDatabase;
  COPILOT_GITHUB_TOKEN: string;
  ALLOWED_ORIGINS: string;
  COPILOT_MODEL: string;
  OPENAI_API_BASE: string;
  /** p. ej. production | preview — metadata LangSmith / filtrado en dashboard */
  DEPLOYMENT_ENV?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_TRACING?: string;
  LANGSMITH_PROJECT?: string;
  LANGCHAIN_CALLBACKS_BACKGROUND?: string;
}
