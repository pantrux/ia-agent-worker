import type { Env } from "../env.js";
import { logWorkerAccess } from "../access-log.js";
import { HitlCallbackV2Schema } from "../canonical/index.js";
import {
  isGraphInterruptError,
  runChatResumeGraph
} from "../chat-invocation.js";
import {
  buildOutboundFromGraphError,
  buildOutboundFromGraphInterrupt,
  buildOutboundFromGraphSuccess
} from "./outbound.js";
import { agentV2ErrorResponse, agentV2SuccessResponse } from "./http.js";

function inferChannelFromConversationId(conversationId: string): string {
  if (conversationId.startsWith("slack:")) return "slack";
  if (conversationId.startsWith("telegram:")) return "telegram";
  if (conversationId.startsWith("teams:")) return "teams";
  if (conversationId.startsWith("gchat:")) return "gchat";
  return "web";
}

function mapCallbackActionToApproved(actionKind: "approve" | "deny" | "custom"): boolean {
  if (actionKind === "approve") return true;
  if (actionKind === "deny") return false;
  throw new Error(`Unsupported HITL callback action kind: ${actionKind}`);
}

export async function handleAgentV2Resume(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  const requestTs = new Date(t0).toISOString();
  const finish = (res: Response, err?: string, traceId?: string) => {
    logWorkerAccess(request, env, {
      operation: "v2_agent_resume",
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

  const parsed = HitlCallbackV2Schema.safeParse(body);
  if (!parsed.success) {
    return finish(
      agentV2ErrorResponse(
        request,
        env,
        400,
        "invalid_payload",
        "Invalid HitlCallbackV2 payload",
        false,
        parsed.error.issues
      ),
      "invalid_payload"
    );
  }

  const callback = parsed.data;
  let approved: boolean;
  try {
    approved = mapCallbackActionToApproved(callback.action.kind);
  } catch (error) {
    return finish(
      agentV2ErrorResponse(
        request,
        env,
        400,
        "unsupported_action",
        error instanceof Error ? error.message : "Unsupported HITL callback action"
      ),
      "unsupported_action",
      callback.trace_id
    );
  }

  const resumeContext = {
    trace_id: callback.trace_id,
    conversation_id: callback.conversation_id,
    reply_token: callback.conversation_id
  };

  try {
    const result = await runChatResumeGraph(env, {
      threadId: callback.conversation_id,
      channel: inferChannelFromConversationId(callback.conversation_id),
      userId: "omni-hitl-resume",
      approved,
      operation: "v2_resume"
    });
    const outbound = buildOutboundFromGraphSuccess(resumeContext, result);
    return finish(agentV2SuccessResponse(request, env, outbound), undefined, callback.trace_id);
  } catch (error) {
    if (isGraphInterruptError(error)) {
      const interruptValue = (error as { value?: unknown }).value;
      try {
        const outbound = buildOutboundFromGraphInterrupt(resumeContext, interruptValue);
        return finish(agentV2SuccessResponse(request, env, outbound), undefined, callback.trace_id);
      } catch (mappingError) {
        console.error("[v2/agent/resume] unsupported interrupt payload:", mappingError);
        return finish(
          agentV2SuccessResponse(
            request,
            env,
            buildOutboundFromGraphError(resumeContext, mappingError, "v2_resume")
          ),
          "unsupported_interrupt",
          callback.trace_id
        );
      }
    }
    console.error("[v2/agent/resume] graph error:", error);
    return finish(
      agentV2SuccessResponse(request, env, buildOutboundFromGraphError(resumeContext, error, "v2_resume")),
      "graph_error",
      callback.trace_id
    );
  }
}
