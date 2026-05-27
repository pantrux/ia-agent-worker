import type { Env } from "../env.js";
import { logWorkerAccess } from "../access-log.js";
import { InboundMessageV2Schema } from "../canonical/index.js";
import {
  isGraphInterruptError,
  runChatMessageGraph
} from "../chat-invocation.js";
import {
  buildOutboundFromGraphError,
  buildOutboundFromGraphInterrupt,
  buildOutboundFromGraphSuccess
} from "./outbound.js";
import { agentV2ErrorResponse, agentV2SuccessResponse } from "./http.js";
import { runAgentV2StreamResponse } from "./run-stream.js";

export async function handleAgentV2Run(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const requestTs = new Date(t0).toISOString();
  const finish = (res: Response, err?: string, traceId?: string) => {
    logWorkerAccess(request, env, {
      operation: "v2_agent_run",
      status: res.status,
      durationMs: Date.now() - t0,
      requestTs,
      trace_id: traceId ?? null,
      error: err
    });
    return res;
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return finish(agentV2ErrorResponse(request, env, 400, "invalid_json", "Request body must be valid JSON"), "invalid_json");
  }

  const parsed = InboundMessageV2Schema.safeParse(body);
  if (!parsed.success) {
    return finish(
      agentV2ErrorResponse(
        request,
        env,
        400,
        "invalid_payload",
        "Invalid InboundMessageV2 payload",
        false,
        parsed.error.issues
      ),
      "invalid_payload"
    );
  }

  const inbound = parsed.data;
  if (inbound.reply_mode === "stream") {
    const streamResponse = await runAgentV2StreamResponse(request, env, inbound);
    return finish(streamResponse, undefined, inbound.trace_id);
  }

  // PAN-95: `async` se ejecuta inline como `sync`; la cola omni llegará en un slice posterior.
  try {
    const result = await runChatMessageGraph(env, {
      text: inbound.text,
      threadId: inbound.conversation_id,
      channel: inbound.channel,
      userId: inbound.user.id,
      operation: "v2_run"
    });
    const outbound = buildOutboundFromGraphSuccess(inbound, result);
    return finish(agentV2SuccessResponse(request, env, outbound), undefined, inbound.trace_id);
  } catch (error) {
    if (isGraphInterruptError(error)) {
      const interruptValue = (error as { value?: unknown }).value;
      try {
        const outbound = buildOutboundFromGraphInterrupt(inbound, interruptValue);
        return finish(agentV2SuccessResponse(request, env, outbound), undefined, inbound.trace_id);
      } catch (mappingError) {
        console.error("[v2/agent/run] unsupported interrupt payload:", mappingError);
        return finish(
          agentV2SuccessResponse(
            request,
            env,
            buildOutboundFromGraphError(inbound, mappingError, "v2_run")
          ),
          "unsupported_interrupt",
          inbound.trace_id
        );
      }
    }
    console.error("[v2/agent/run] graph error:", error);
    return finish(
      agentV2SuccessResponse(request, env, buildOutboundFromGraphError(inbound, error, "v2_run")),
      "graph_error",
      inbound.trace_id
    );
  }
}
