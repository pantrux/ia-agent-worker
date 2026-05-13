import type { ValidationResult } from "./types.js";

export function validate(text: string): ValidationResult {
  if (/\b(insider|guaranteed\s+return|no\s+risk)\b/i.test(text)) {
    return { ok: false, feedback: "Remove prohibited financial advice language (insider tips, guaranteed returns)." };
  }
  return { ok: true, feedback: "" };
}
