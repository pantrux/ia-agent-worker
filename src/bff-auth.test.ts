import { describe, expect, it } from "vitest";
import { isBffBearerConfigured, parseTrustedAaasUserIdHeader } from "./bff-auth.js";
import type { Env } from "./env.js";

function partialEnv(p: Partial<Env>): Env {
  return p as Env;
}

describe("isBffBearerConfigured", () => {
  it("false si no hay token", () => {
    expect(isBffBearerConfigured(partialEnv({}))).toBe(false);
    expect(isBffBearerConfigured(partialEnv({ BFF_API_TOKEN: "" }))).toBe(false);
    expect(isBffBearerConfigured(partialEnv({ BFF_API_TOKEN: "   " }))).toBe(false);
  });

  it("true si hay token no vacío", () => {
    expect(isBffBearerConfigured(partialEnv({ BFF_API_TOKEN: "secret" }))).toBe(true);
  });
});

describe("parseTrustedAaasUserIdHeader", () => {
  const uid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  it("sin BFF_API_TOKEN ignora cabecera", () => {
    const req = new Request("http://x", { headers: { "X-AAAS-User-Id": uid } });
    expect(parseTrustedAaasUserIdHeader(req, partialEnv({}))).toBeUndefined();
  });

  it("con BFF_API_TOKEN acepta UUID v4 válido", () => {
    const req = new Request("http://x", { headers: { "X-AAAS-User-Id": uid } });
    expect(parseTrustedAaasUserIdHeader(req, partialEnv({ BFF_API_TOKEN: "x" }))).toBe(uid);
  });

  it("con BFF_API_TOKEN rechaza valor no UUID", () => {
    const req = new Request("http://x", { headers: { "X-AAAS-User-Id": "not-uuid" } });
    expect(parseTrustedAaasUserIdHeader(req, partialEnv({ BFF_API_TOKEN: "x" }))).toBeUndefined();
  });

  it("con BFF_API_TOKEN y sin cabecera X-AAAS-User-Id devuelve undefined", () => {
    const req = new Request("http://x");
    expect(parseTrustedAaasUserIdHeader(req, partialEnv({ BFF_API_TOKEN: "secret" }))).toBeUndefined();
  });
});
