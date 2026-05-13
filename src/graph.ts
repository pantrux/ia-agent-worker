import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { D1Database } from "@cloudflare/workers-types";
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

/** D1 expone `batch`; la implementación sql.js de `CrmDatabase` solo expone `prepare`. */
function d1DatabaseForCheckpointOrThrow(db: Env["DB"]): D1Database {
  if (typeof (db as { batch?: unknown }).batch === "function") {
    return db as D1Database;
  }
  throw new Error(
    "buildGraph: el checkpointer por defecto (D1Saver) requiere un binding D1 en env.DB, o bien pasa options.checkpointer (p. ej. MemorySaver en Agent Server)."
  );
}

export function buildGraph(env: Env, options?: { checkpointer?: BaseCheckpointSaver }) {
  const checkpointer = options?.checkpointer ?? new D1Saver(d1DatabaseForCheckpointOrThrow(env.DB));

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
