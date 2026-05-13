import { END, START, StateGraph } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { GraphAnnotation, type GraphState } from "./state.js";
import type { Env } from "./env.js";
import { D1Saver } from "./persistence/d1-saver.js";
import { createRouterNode } from "./nodes/router.js";
import { createModelNode } from "./nodes/model.js";
import { createToolsNode } from "./nodes/tools.js";
import { createValidationNode, MAX_VALIDATION_RETRIES } from "./nodes/validation.js";

function routeAfterModel(state: GraphState): "tools" | "validation" {
  const last = state.messages[state.messages.length - 1];
  if (last instanceof AIMessage && last.tool_calls?.length) {
    return "tools";
  }
  return "validation";
}

function routeAfterValidation(state: GraphState): "model" | typeof END {
  if (state.validationPass) return END;
  if ((state.retryCount ?? 0) > MAX_VALIDATION_RETRIES) return END;
  return "model";
}

export function buildGraph(env: Env) {
  const checkpointer = new D1Saver(env.DB);

  const graph = new StateGraph(GraphAnnotation)
    .addNode("router", createRouterNode(env))
    .addNode("model", createModelNode(env))
    .addNode("tools", createToolsNode(env))
    .addNode("validation", createValidationNode())
    .addEdge(START, "router")
    .addEdge("router", "model")
    .addConditionalEdges("model", routeAfterModel, { tools: "tools", validation: "validation" })
    .addEdge("tools", "model")
    .addConditionalEdges("validation", routeAfterValidation, { model: "model", [END]: END });

  return graph.compile({ checkpointer });
}
