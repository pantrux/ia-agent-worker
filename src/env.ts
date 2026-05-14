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
  /** Identificador de la cuenta de Cloudflare en la ruta del AI Gateway. Con `AI_GATEWAY_ID`, la URL base del cliente apunta al gateway. */
  AI_GATEWAY_ACCOUNT_ID?: string;
  /** Nombre o identificador del gateway en la ruta (`…/v1/{cuenta}/{este valor}/…`). */
  AI_GATEWAY_ID?: string;
  /** Token de Cloudflare para la cabecera `cf-aig-authorization` si el gateway exige autenticación; conviene definirlo como secreto. */
  AI_GATEWAY_API_TOKEN?: string;
  /** Slug del custom provider (sin prefijo `custom-`). Si está definido, el cliente usa la ruta específica `…/custom-{slug}/{AI_GATEWAY_PROVIDER_PATH}` y el campo `model` es el id del catálogo (p. ej. `openai/gpt-5-mini`). El `base_url` del proveedor en Cloudflare debe ser `https://models.github.ai`. */
  AI_GATEWAY_PROVIDER_SLUG?: string;
  /** Segmento de ruta tras `…/custom-{slug}/` hacia el upstream (sin slashes iniciales/finales). Por defecto `inference` (GitHub Models). */
  AI_GATEWAY_PROVIDER_PATH?: string;
  /** Si es `true` o `1`, las respuestas 500 de `/api/chat` y `/api/chat/resume` incluyen `detail` con el mensaje de error (solo depuración; no usar en prod pública). */
  EXPOSE_CHAT_ERROR?: string;
}
