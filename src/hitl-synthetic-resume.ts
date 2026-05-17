import { AIMessage, ToolMessage } from "@langchain/core/messages";
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

  if (!params.approved) {
    const toolMsg = new ToolMessage({
      content: "Operator denied this CRM mutation.",
      tool_call_id: toolCallId,
    });
    await graph.updateState(config, {
      messages: [toolMsg],
      toolState: nextToolState,
    });
    return {
      ...stateValues,
      messages: [toolMsg, new AIMessage({ content: "Operación de borrado denegada por el operador." })],
      toolState: nextToolState,
    } as GraphInvokeResult;
  }

  const crm = createCrmTools(env.DB);
  const rawResult = await crm.deleteCustomerRecord.invoke({ customer_id: customerId });
  const toolMsg = new ToolMessage({ content: String(rawResult), tool_call_id: toolCallId });
  await graph.updateState(config, {
    messages: [toolMsg],
    toolState: nextToolState,
  });

  let replyText: string;
  try {
    const parsed = JSON.parse(String(rawResult)) as { ok?: boolean; deleted_id?: string; error?: string };
    replyText = parsed.ok
      ? `Cliente ${parsed.deleted_id ?? customerId} eliminado del CRM.`
      : `No se pudo eliminar el cliente: ${parsed.error ?? String(rawResult)}`;
  } catch {
    replyText = String(rawResult);
  }

  return {
    ...stateValues,
    messages: [toolMsg, new AIMessage({ content: replyText })],
    toolState: nextToolState,
  } as GraphInvokeResult;
}
