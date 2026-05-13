import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export type Industry = "retail" | "finance" | "health" | "unknown";

export const GraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  industry: Annotation<Industry>({
    reducer: (_prev, next) => next,
    default: () => "unknown",
  }),
  intent: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  toolState: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  validationPass: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  policyFeedback: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  retryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

export type GraphState = typeof GraphAnnotation.State;
