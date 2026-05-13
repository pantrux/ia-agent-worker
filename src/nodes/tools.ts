import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { GraphState } from "../state.js";
import type { Env } from "../env.js";
import { CRITICAL_TOOL_NAMES, getToolsForIndustry } from "../tools/crm.js";

export function createToolsNode(env: Env) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const last = state.messages[state.messages.length - 1];
    if (!(last instanceof AIMessage) || !last.tool_calls?.length) {
      return {};
    }

    const tools = getToolsForIndustry(state.industry, env.DB);
    const byName = new Map(tools.map((t) => [t.name, t]));
    const outMsgs: ToolMessage[] = [];

    for (const tc of last.tool_calls) {
      const name = tc.name;
      const args = tc.args ?? {};
      const tid = tc.id ?? "call";

      if (CRITICAL_TOOL_NAMES.has(name)) {
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
          outMsgs.push(new ToolMessage({ content: "Operator denied this CRM mutation.", tool_call_id: tid }));
          continue;
        }
      }

      const toolFn = byName.get(name);
      if (!toolFn) {
        outMsgs.push(new ToolMessage({ content: `Tool not available: ${name}`, tool_call_id: tid }));
        continue;
      }

      try {
        const result = await (toolFn as { invoke(input: Record<string, unknown>): Promise<unknown> }).invoke(args);
        outMsgs.push(new ToolMessage({ content: String(result), tool_call_id: tid }));
      } catch (e: unknown) {
        outMsgs.push(new ToolMessage({ content: `Tool error: ${String(e)}`, tool_call_id: tid }));
      }
    }

    return {
      messages: outMsgs,
      toolState: { ...state.toolState, last_executed_batch: outMsgs.map((m) => m.tool_call_id) },
    };
  };
}
