import type { Industry } from "../state.js";
import type { ValidationResult } from "./types.js";
import { validate as validateRetail } from "./retail.js";
import { validate as validateFinance } from "./finance.js";
import { validate as validateHealth } from "./health.js";

export type ValidatorFn = (text: string) => ValidationResult;

const VALIDATORS: Record<Industry, ValidatorFn> = {
  retail: validateRetail,
  finance: validateFinance,
  health: validateHealth,
  unknown: () => ({ ok: true, feedback: "" }),
};

export function getValidator(industry: Industry): ValidatorFn {
  return VALIDATORS[industry] ?? VALIDATORS.unknown;
}
