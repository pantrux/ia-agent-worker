import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { Env } from "./env.js";
import type { buildGraph } from "./graph.js";
import {
  OPERATOR_DENIED_TOOL_CONTENT,
  SYNTHETIC_HITL_PENDING_KEY,
  type HitlApprovalPayload,
} from "./hitl-pending.js";
import type { GraphState } from "./state.js";
import { createCrmTools } from "./tools/crm.js";

type GraphInvokeResult = Awaited<ReturnType<ReturnType<typeof buildGraph>["invoke"]>>;

export function snapshotHasPendingInterrupt(snapshot: {
  tasks?: Array<{ interrupts?: unknown[] }>;
}): boolean {
  if (!Array.isArray(snapshot.tasks)) return false;
  return snapshot.tasks.some((t) => Array.isArray(t.interrupts) && t.interrupts.length > 0);
}

/** Paridad con tools_node: ToolMessage debe ir precedido por AIMessage con tool_calls. */
function syntheticAiWithToolCall(pending: HitlApprovalPayload): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [
      {
        id: pending.tool_call_id,
        name: pending.tool,
        args: pending.args,
      },
    ],
  });
}

function buildResumeResult(
  stateValues: GraphState,
  appended: BaseMessage[],
  toolState: Record<string, unknown>
): GraphInvokeResult {
  return {
    ...stateValues,
    messages: [...stateValues.messages, ...appended],
    toolState,
  } as GraphInvokeResult;
}

function replyTextFromDeleteResult(rawResult: string, customerId: string): string {
  try {
    const parsed = JSON.parse(rawResult) as { ok?: boolean; deleted_id?: string; error?: string };
    if (parsed.ok) return `Cliente ${parsed.deleted_id ?? customerId} eliminado del CRM.`;
    return `No se pudo eliminar el cliente: ${parsed.error ?? rawResult}`;
  } catch {
    return rawResult;
  }
}

export async function executeSyntheticHitlResume(
  env: Env,
  graph: { updateState(config: unknown, update: Partial<GraphState>): Promise<void> },
  config: unknown,
  params: { approved: boolean },
  pending: HitlApprovalPayload,
  stateValues: GraphState
): Promise<GraphInvokeResult> {
  const customerId = String(pending.args?.customer_id ?? "");
  const toolCallId = pending.tool_call_id;
  const nextToolState = { ...stateValues.toolState };
  delete nextToolState[SYNTHETIC_HITL_PENDING_KEY];

  await graph.updateState(config, { toolState: nextToolState });

  const aiToolCall = syntheticAiWithToolCall(pending);

  if (!params.approved) {
    const toolMsg = new ToolMessage({
      content: OPERATOR_DENIED_TOOL_CONTENT,
      tool_call_id: toolCallId,
    });
    const aiMsg = new AIMessage({ content: "Operación de borrado denegada por el operador." });
    const appended = [aiToolCall, toolMsg, aiMsg];
    await graph.updateState(config, {
      messages: appended,
      toolState: nextToolState,
    });
    return buildResumeResult(stateValues, appended, nextToolState);
  }

  if (!customerId) {
    const toolMsg = new ToolMessage({
      content: "Error: missing customer_id",
      tool_call_id: toolCallId,
    });
    const aiMsg = new AIMessage({ content: "No se pudo identificar el cliente a eliminar." });
    const appended = [aiToolCall, toolMsg, aiMsg];
    await graph.updateState(config, {
      messages: appended,
      toolState: nextToolState,
    });
    return buildResumeResult(stateValues, appended, nextToolState);
  }

  const crm = createCrmTools(env.DB);
  let rawResult: string;
  try {
    rawResult = String(await crm.deleteCustomerRecord.invoke({ customer_id: customerId }));
  } catch (err) {
    const toolMsg = new ToolMessage({
      content: `Error: ${String(err)}`,
      tool_call_id: toolCallId,
    });
    const aiMsg = new AIMessage({ content: "No se pudo eliminar el cliente: error interno." });
    const appended = [aiToolCall, toolMsg, aiMsg];
    await graph.updateState(config, {
      messages: appended,
      toolState: nextToolState,
    });
    return buildResumeResult(stateValues, appended, nextToolState);
  }

  const toolMsg = new ToolMessage({ content: rawResult, tool_call_id: toolCallId });
  const aiMsg = new AIMessage({ content: replyTextFromDeleteResult(rawResult, customerId) });
  const appended = [aiToolCall, toolMsg, aiMsg];
  await graph.updateState(config, {
    messages: appended,
    toolState: nextToolState,
  });
  return buildResumeResult(stateValues, appended, nextToolState);
}
