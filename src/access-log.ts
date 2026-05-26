import type { Env } from "./env.js";

export type AccessOperation =
  | "cors_preflight"
  | "ping"
  | "chat"
  | "resume"
  | "agent_messages_enqueue"
  | "bff_auth"
  | "internal_auth"
  | "v2_agent_run"
  | "v2_agent_resume"
  | "agent_route"
  | "not_found"
  | "unknown";

export interface AccessLogFields {
  operation: AccessOperation;
  status: number;
  durationMs: number;
  /** ISO del instante de entrada al handler (alinear con Logpush / ventanas temporales). */
  requestTs: string;
  thread_id?: string;
  trace_id?: string | null;
  /** UUID público de auth (solo si BFF autenticó y cabecera válida). */
  aaas_user_id?: string | null;
  /** Sin stack ni mensaje crudo: código o nombre corto si aplica. */
  error?: string;
}

/**
 * Una línea JSON por petición para Logpush / filtrado en el dashboard de Workers.
 * No incluye cuerpos de chat ni PII del mensaje del usuario.
 */
export function logWorkerAccess(request: Request, env: Env, fields: AccessLogFields): void {
  const url = new URL(request.url);
  const cf = request.cf as { colo?: string } | undefined;
  const payload = {
    msg: "ia_agent_access",
    level: fields.status >= 500 ? "error" : fields.status >= 400 ? "warn" : "info",
    ts: fields.requestTs,
    method: request.method,
    path: url.pathname,
    status: fields.status,
    duration_ms: fields.durationMs,
    operation: fields.operation,
    deployment: env.DEPLOYMENT_ENV ?? null,
    thread_id: fields.thread_id ?? null,
    trace_id: fields.trace_id ?? null,
    aaas_user_id: fields.aaas_user_id ?? null,
    cf_ray: request.headers.get("CF-Ray"),
    colo: cf?.colo ?? null,
    error: fields.error ?? null,
  };
  console.log(JSON.stringify(payload));
}
