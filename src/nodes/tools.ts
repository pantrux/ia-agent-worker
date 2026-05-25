import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { CRITICAL_TOOL_NAMES, getToolsForIndustry } from "../tools/crm.js";
import {
  findPreviousToolResultForCall,
  isKnownTerminalToolResult,
  OPERATOR_DENIED_TOOL_CONTENT,
} from "../hitl-pending.js";

type InvocableTool = { invoke(input: Record<string, unknown>): Promise<unknown> };

async function invokeTool(toolFn: InvocableTool, args: Record<string, unknown>, tid: string): Promise<ToolMessage> {
  try {
    const result = await toolFn.invoke(args);
    return new ToolMessage({ content: String(result), tool_call_id: tid });
  } catch (e: unknown) {
    return new ToolMessage({ content: `Tool error: ${String(e)}`, tool_call_id: tid });
  }
}

/**
 * PAN-39: para `delete_customer_record`, comprueba si el `customer_id` existe en D1 antes
 * de pedir aprobación HITL.
 *
 * - Si la consulta D1 falla (timeout, indisponibilidad), devuelve `undefined` para caer al
 *   flujo HITL normal en lugar de crashear el nodo (Gitar/Devin: bug por excepción no
 *   manejada).
 * - Si la consulta confirma que el `customer_id` no existe, emite directamente el
 *   `ToolMessage` con `{"error":"Customer not found"}` sin invocar la tool real, evitando
 *   una segunda lectura idéntica y la ventana TOCTOU señalada por Greptile (P2): un
 *   proceso concurrente podría crear el cliente entre la consulta y el delete, con lo que
 *   la tool lo encontraría y lo borraría sin pasar por aprobación.
 * - En cualquier otro caso (existe o no se pudo verificar) devuelve `undefined` para que
 *   `tools_node` siga su flujo habitual de `interrupt(...)`.
 */
async function preflightDeleteCustomerRecord(
  env: Env,
  args: Record<string, unknown>,
  tid: string
): Promise<ToolMessage | undefined> {
  const customerId = String((args as { customer_id?: string }).customer_id ?? "");
  if (!customerId) return undefined;
  let exists: unknown;
  try {
    exists = await env.DB.prepare(`SELECT id FROM customers WHERE id = ?`).bind(customerId).first();
  } catch {
    return undefined;
  }
  if (exists) return undefined;
  return new ToolMessage({
    content: JSON.stringify({ error: "Customer not found" }),
    tool_call_id: tid,
  });
}

export function createToolsNode(env: Env) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const last = state.messages[state.messages.length - 1];
    if (!(last instanceof AIMessage) || !last.tool_calls?.length) {
      return {};
    }

    const tools = getToolsForIndustry(state.industry, env.DB);
    const byName = new Map(tools.map((t) => [t.name, t]));
    const history = state.messages.slice(0, -1);
    const outMsgs: ToolMessage[] = [];

    for (const tc of last.tool_calls) {
      const name = tc.name;
      const args = tc.args ?? {};
      const tid = tc.id ?? "call";

      if (CRITICAL_TOOL_NAMES.has(name)) {
        const previous = findPreviousToolResultForCall(history, name, args);
        if (previous !== undefined && isKnownTerminalToolResult(previous)) {
          outMsgs.push(new ToolMessage({ content: previous, tool_call_id: tid }));
          continue;
        }

        if (name === "delete_customer_record") {
          const preflight = await preflightDeleteCustomerRecord(env, args, tid);
          if (preflight) {
            outMsgs.push(preflight);
            continue;
          }
        }

        const decision = interrupt({
          kind: "tool_approval",
          tool: name,
          args,
          tool_call_id: tid,
        });
        const approved =
          typeof decision === "object" && decision !== null && "approved" in decision
            ? Boolean((decision as Record<string, unknown>).approved)
            : Boolean(decision);
        if (!approved) {
          outMsgs.push(new ToolMessage({ content: OPERATOR_DENIED_TOOL_CONTENT, tool_call_id: tid }));
          continue;
        }
      }

      const toolFn = byName.get(name);
      if (!toolFn) {
        outMsgs.push(new ToolMessage({ content: `Tool not available: ${name}`, tool_call_id: tid }));
        continue;
      }

      outMsgs.push(await invokeTool(toolFn as InvocableTool, args, tid));
    }

    return {
      messages: outMsgs,
      toolState: { ...state.toolState, last_executed_batch: outMsgs.map((m) => m.tool_call_id) },
    };
  };
}
