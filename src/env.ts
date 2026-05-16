import type { KVNamespace, Queue } from "@cloudflare/workers-types";
import type { CrmDatabase } from "./db/crm-db.js";
import type { NormalizedChatPayload } from "./chat-queue-payload.js";

export interface Env {
  DB: CrmDatabase;
  /** Producer PAN-17: mensajes normalizados hacia el consumer del mismo Worker. */
  CHAT_INGEST_QUEUE: Queue<NormalizedChatPayload>;
  /** PAN-18: `telegram:chat:{id}` → `thread_id` UUID para continuidad de conversación. */
  CHAT_THREAD_KV?: KVNamespace;
  /** Bot API token para entrega Telegram desde el consumer de cola. */
  TELEGRAM_BOT_TOKEN?: string;
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
  /**
   * Si es `1`/`true`/`yes`/`on`, las llamadas LLM van directo a `OPENAI_API_BASE` (p. ej. GitHub Models)
   * y se ignoran `AI_GATEWAY_*` (útil para aislar 404 del gateway frente al upstream).
   */
  AI_GATEWAY_DISABLED?: string;
  /** Identificador de la cuenta de Cloudflare en la ruta del AI Gateway. Con `AI_GATEWAY_ID`, la URL base del cliente apunta al gateway. */
  AI_GATEWAY_ACCOUNT_ID?: string;
  /** Nombre o identificador del gateway en la ruta (`…/v1/{cuenta}/{este valor}/…`). */
  AI_GATEWAY_ID?: string;
  /** Token de Cloudflare para la cabecera `cf-aig-authorization` si el gateway exige autenticación; conviene definirlo como secreto. */
  AI_GATEWAY_API_TOKEN?: string;
  /**
   * Slug del custom provider en AI Gateway (sin prefijo `custom-`).
   * Con GitHub Models: `base_url` del proveedor = `https://models.github.ai` y suele usarse `AI_GATEWAY_PROVIDER_PATH=inference`.
   * Con Copilot Enterprise: `base_url` = host Copilot; el Worker usa **`/compat`** y el modelo `custom-{slug}/…` (no la ruta `…/custom-{slug}/v1`).
   */
  AI_GATEWAY_PROVIDER_SLUG?: string;
  /**
   * Solo **GitHub Models** vía ruta `…/custom-{slug}/{path}/chat/completions`. Por defecto `inference`.
   * Con Copilot + gateway el Worker ignora este valor (usa `/compat`).
   */
  AI_GATEWAY_PROVIDER_PATH?: string;
  /** Si es `true` o `1`, las respuestas 500 de `/api/chat` y `/api/chat/resume` incluyen `detail` con el mensaje de error (solo depuración; no usar en prod pública). */
  EXPOSE_CHAT_ERROR?: string;
  /**
   * Login de la organización GitHub (slug). Si está definido y `OPENAI_API_BASE` es la inferencia global
   * `https://models.github.ai/inference`, las peticiones usan `https://models.github.ai/orgs/{org}/inference`
   * (atribución a org; a veces es el único contexto con modelos habilitados).
   */
  GITHUB_MODELS_ORG?: string;
  /** Cabecera `X-GitHub-Api-Version` hacia `models.github.ai`. Por defecto `2026-03-10` (REST Models). */
  GITHUB_MODELS_API_VERSION?: string;
}
