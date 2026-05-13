import "./load-env.js";
import { MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "../graph.js";
import { loadStudioEnv } from "./studio-env.js";

const env = await loadStudioEnv();

if (env.LANGSMITH_API_KEY) {
  process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
  if (env.LANGSMITH_TRACING) process.env.LANGSMITH_TRACING = env.LANGSMITH_TRACING;
  if (env.LANGSMITH_PROJECT) process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
  if (env.LANGCHAIN_CALLBACKS_BACKGROUND) {
    process.env.LANGCHAIN_CALLBACKS_BACKGROUND = env.LANGCHAIN_CALLBACKS_BACKGROUND;
  }
}

/** Compiled graph for LangSmith Studio / `langgraphjs dev` (assistant id: `agent`). */
export const graph = buildGraph(env, { checkpointer: new MemorySaver() });
