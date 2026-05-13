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
  /** Secreto opcional: si está definido, POST /api/chat y /api/chat/resume exigen `Authorization: Bearer …`. */
  BFF_API_TOKEN?: string;
  /** Cloudflare account ID (AI Gateway). Con `AI_GATEWAY_ID`, baseURL → endpoint compat unificado. */
  AI_GATEWAY_ACCOUNT_ID?: string;
  /** Identificador del gateway en la URL (`…/v1/{account}/{AI_GATEWAY_ID}/compat`). */
  AI_GATEWAY_ID?: string;
  /** Token CF para cabecera `cf-aig-authorization` si el gateway exige autenticación. Secreto recomendado. */
  AI_GATEWAY_API_TOKEN?: string;
  /** Slug del proveedor personalizado (p. ej. GitHub Models vía custom provider): modelo enviado como `slug/COPILOT_MODEL`. */
  AI_GATEWAY_PROVIDER_SLUG?: string;
}
