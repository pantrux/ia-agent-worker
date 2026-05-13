import type { ValidationResult } from "./types.js";

export function validate(text: string): ValidationResult {
  const lower = text.toLowerCase();
  if (lower.includes("confidential") && lower.includes("price")) {
    return { ok: false, feedback: "Avoid sharing confidential competitor pricing without approval." };
  }
  return { ok: true, feedback: "" };
}
