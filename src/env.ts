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
  /** Identificador de la cuenta de Cloudflare en la ruta del AI Gateway. Con `AI_GATEWAY_ID`, la URL base del cliente apunta al endpoint «compat» unificado. */
  AI_GATEWAY_ACCOUNT_ID?: string;
  /** Nombre o identificador del gateway en la ruta (`…/v1/{cuenta}/{este valor}/compat`). */
  AI_GATEWAY_ID?: string;
  /** Token de Cloudflare para la cabecera `cf-aig-authorization` si el gateway exige autenticación; conviene definirlo como secreto. */
  AI_GATEWAY_API_TOKEN?: string;
  /** Identificador corto (slug) del proveedor personalizado; el modelo se envía como `slug/COPILOT_MODEL` (p. ej. GitHub Models detrás de un custom provider). */
  AI_GATEWAY_PROVIDER_SLUG?: string;
}
