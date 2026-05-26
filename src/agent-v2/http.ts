import type { Env } from "../env.js";
import { corsHeaders } from "../cors.js";

export function jsonAgentV2(data: unknown, status: number, request: Request, env: Env): Response {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request, env)
  };
  return new Response(JSON.stringify(data), { status, headers });
}

export function agentV2ErrorResponse(
  request: Request,
  env: Env,
  status: number,
  code: string,
  message: string,
  retryable = false,
  issues?: unknown
): Response {
  return jsonAgentV2(
    {
      ok: false,
      error: { code, message, retryable },
      ...(issues !== undefined ? { issues } : {})
    },
    status,
    request,
    env
  );
}

export function agentV2SuccessResponse(
  request: Request,
  env: Env,
  outbound: unknown,
  status = 200
): Response {
  return jsonAgentV2({ ok: true, outbound }, status, request, env);
}
