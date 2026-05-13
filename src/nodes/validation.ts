import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { GraphState } from "../state.js";
import { getValidator } from "../validators/index.js";

const MAX_VALIDATION_RETRIES = 3;

function getLastAIText(messages: GraphState["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m instanceof AIMessage) {
      const c = m.content;
      return typeof c === "string" ? c : String(c);
    }
  }
  return "";
}

export function createValidationNode() {
  return (state: GraphState): Partial<GraphState> => {
    const text = getLastAIText(state.messages);
    const validator = getValidator(state.industry);
    const result = validator(text);

    if (result.ok) {
      return { validationPass: true, policyFeedback: "" };
    }

    const retries = state.retryCount ?? 0;
    if (retries >= MAX_VALIDATION_RETRIES) {
      const apology = new HumanMessage(
        `[policy] Maximum retries reached. Last policy issue: ${result.feedback}. ` +
          `Please rephrase your request without violating industry rules.`
      );
      return {
        validationPass: false,
        policyFeedback: result.feedback,
        retryCount: retries + 1,
        messages: [apology],
      };
    }

    const hint = new HumanMessage(
      `[policy] Your previous reply failed validation (${result.feedback}). ` +
        `Regenerate a compliant answer; do not repeat the violation.`
    );
    return {
      validationPass: false,
      policyFeedback: result.feedback,
      retryCount: retries + 1,
      messages: [hint],
    };
  };
}

export { MAX_VALIDATION_RETRIES };
