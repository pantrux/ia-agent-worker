import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { Env } from "./env.js";
import type { buildGraph } from "./graph.js";
import {
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

  if (!params.approved) {
    const toolMsg = new ToolMessage({
      content: "Operator denied this CRM mutation.",
      tool_call_id: toolCallId,
    });
    const aiMsg = new AIMessage({ content: "Operación de borrado denegada por el operador." });
    await graph.updateState(config, {
      messages: [toolMsg, aiMsg],
      toolState: nextToolState,
    });
    return buildResumeResult(stateValues, [toolMsg, aiMsg], nextToolState);
  }

  if (!customerId) {
    const toolMsg = new ToolMessage({
      content: "Error: missing customer_id",
      tool_call_id: toolCallId,
    });
    const aiMsg = new AIMessage({ content: "No se pudo identificar el cliente a eliminar." });
    await graph.updateState(config, {
      messages: [toolMsg, aiMsg],
      toolState: nextToolState,
    });
    return buildResumeResult(stateValues, [toolMsg, aiMsg], nextToolState);
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
    await graph.updateState(config, {
      messages: [toolMsg, aiMsg],
      toolState: nextToolState,
    });
    return buildResumeResult(stateValues, [toolMsg, aiMsg], nextToolState);
  }

  const toolMsg = new ToolMessage({ content: rawResult, tool_call_id: toolCallId });
  const aiMsg = new AIMessage({ content: replyTextFromDeleteResult(rawResult, customerId) });
  await graph.updateState(config, {
    messages: [toolMsg, aiMsg],
    toolState: nextToolState,
  });
  return buildResumeResult(stateValues, [toolMsg, aiMsg], nextToolState);
}
