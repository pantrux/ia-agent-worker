import { describe, expect, it } from "vitest";
import { isInternalBearerConfigured, verifyInternalApiAuth } from "./internal-auth.js";
import type { Env } from "./env.js";

const envWithToken = (token: string | undefined): Env =>
  ({
    AGENT_INTERNAL_TOKEN: token
  }) as Env;

function requestWithBearer(token: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://worker.test/v2/agent/run", {
    method: "POST",
    headers,
    body: "{}"
  });
}

describe("verifyInternalApiAuth", () => {
  it("returns ok when AGENT_INTERNAL_TOKEN is not configured", () => {
    expect(verifyInternalApiAuth(requestWithBearer(null), envWithToken(undefined))).toEqual({ ok: true });
  });

  it("returns ok when bearer token matches", () => {
    expect(
      verifyInternalApiAuth(requestWithBearer("internal-secret-001"), envWithToken("internal-secret-001"))
    ).toEqual({ ok: true });
  });

  it("returns missing_bearer when Authorization header is absent", () => {
    const result = verifyInternalApiAuth(requestWithBearer(null), envWithToken("internal-secret-001"));
    expect(result).toEqual({ ok: false, reason: "missing_bearer" });
  });

  it("returns invalid_token when bearer token does not match", () => {
    const result = verifyInternalApiAuth(
      requestWithBearer("wrong-token"),
      envWithToken("internal-secret-001")
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });
});

describe("isInternalBearerConfigured", () => {
  it("returns false when token is missing", () => {
    expect(isInternalBearerConfigured(envWithToken(undefined))).toBe(false);
  });

  it("returns true when token is configured", () => {
    expect(isInternalBearerConfigured(envWithToken("internal-secret-001"))).toBe(true);
  });
});
