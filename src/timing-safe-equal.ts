import { timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

/** Comparación resistente a timing para tokens UTF-8 (requiere `nodejs_compat`). */
export function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ua = encoder.encode(a);
  const ub = encoder.encode(b);
  if (ua.length !== ub.length) return false;
  return timingSafeEqual(ua, ub);
}
