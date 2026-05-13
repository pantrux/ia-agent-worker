import type { ValidationResult } from "./types.js";

const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,  // SSN-like
  /\b\d{16}\b/,              // payment card-like
];

export function validate(text: string): ValidationResult {
  for (const pat of PHI_PATTERNS) {
    if (pat.test(text)) {
      return {
        ok: false,
        feedback: "Potential PHI detected. Do not include SSN-like or payment-card-like numbers in assistant replies.",
      };
    }
  }
  return { ok: true, feedback: "" };
}
