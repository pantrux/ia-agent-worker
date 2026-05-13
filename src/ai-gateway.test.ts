import { describe, it, expect } from "vitest";
import {
  aiGatewayCompatBaseUrl,
  aiGatewayCustomProviderBaseUrl,
  resolveAiGatewayLlmConfig,
  type UpstreamLlmCredentials,
} from "./ai-gateway.js";
import type { Env } from "./env.js";

// Minimal Env stub — only fields used by resolveAiGatewayLlmConfig
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    COPILOT_GITHUB_TOKEN: "gh-token",
    ALLOWED_ORIGINS: "*",
    COPILOT_MODEL: "openai/gpt-4o-mini",
    OPENAI_API_BASE: "https://models.github.ai/inference",
    ...overrides,
  };
}

const upstream: UpstreamLlmCredentials = {
  apiKey: "upstream-key",
  baseUrl: "https://models.github.ai/inference",
};

// ---------------------------------------------------------------------------
// aiGatewayCompatBaseUrl
// ---------------------------------------------------------------------------
describe("aiGatewayCompatBaseUrl", () => {
  it("builds the /compat URL from accountId and gatewayId", () => {
    expect(aiGatewayCompatBaseUrl("acc123", "gw456")).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat"
    );
  });

  it("trims whitespace from accountId and gatewayId", () => {
    expect(aiGatewayCompatBaseUrl("  acc123  ", "  gw456  ")).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat"
    );
  });
});

// ---------------------------------------------------------------------------
// aiGatewayCustomProviderBaseUrl
// ---------------------------------------------------------------------------
describe("aiGatewayCustomProviderBaseUrl", () => {
  it("builds the /custom-{slug} URL", () => {
    expect(aiGatewayCustomProviderBaseUrl("acc123", "gw456", "github-models")).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc123/gw456/custom-github-models"
    );
  });

  it("strips a redundant custom- prefix from slugWithoutCustomPrefix", () => {
    expect(aiGatewayCustomProviderBaseUrl("acc123", "gw456", "custom-github-models")).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc123/gw456/custom-github-models"
    );
  });

  it("trims whitespace from all parameters", () => {
    expect(aiGatewayCustomProviderBaseUrl("  acc  ", "  gw  ", "  slug  ")).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc/gw/custom-slug"
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAiGatewayLlmConfig
// ---------------------------------------------------------------------------
describe("resolveAiGatewayLlmConfig", () => {
  // --- No gateway configured ---
  describe("when AI_GATEWAY_ACCOUNT_ID or AI_GATEWAY_ID is absent", () => {
    it("returns upstream config unchanged when both env vars are missing", () => {
      const env = makeEnv();
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result).toEqual({
        apiKey: upstream.apiKey,
        baseUrl: upstream.baseUrl,
        model: "openai/gpt-4o-mini",
      });
    });

    it("returns upstream config when only AI_GATEWAY_ACCOUNT_ID is set", () => {
      const env = makeEnv({ AI_GATEWAY_ACCOUNT_ID: "acc123" });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe(upstream.baseUrl);
    });

    it("returns upstream config when only AI_GATEWAY_ID is set", () => {
      const env = makeEnv({ AI_GATEWAY_ID: "gw456" });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe(upstream.baseUrl);
    });

    it("returns upstream config for empty-string AI_GATEWAY_ACCOUNT_ID", () => {
      const env = makeEnv({ AI_GATEWAY_ACCOUNT_ID: "", AI_GATEWAY_ID: "gw456" });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe(upstream.baseUrl);
    });
  });

  // --- Gateway configured, no slug ---
  describe("when gateway is configured but no AI_GATEWAY_PROVIDER_SLUG", () => {
    it("uses the /compat base URL and passes model unchanged", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat");
      expect(result.model).toBe("openai/gpt-4o-mini");
      expect(result.apiKey).toBe(upstream.apiKey);
      expect(result.defaultHeaders).toBeUndefined();
    });

    it("does not add defaultHeaders when AI_GATEWAY_API_TOKEN is absent", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.defaultHeaders).toBeUndefined();
    });

    it("adds cf-aig-authorization header when AI_GATEWAY_API_TOKEN is set", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_API_TOKEN: "my-gw-token",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.defaultHeaders).toEqual({
        "cf-aig-authorization": "Bearer my-gw-token",
      });
    });
  });

  // --- Gateway configured, slug provided (the key new behavior) ---
  describe("when AI_GATEWAY_PROVIDER_SLUG is set (new /compat + prefix-model behavior)", () => {
    it("uses the /compat base URL (not the /custom-{slug} URL)", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat");
      expect(result.baseUrl).not.toContain("custom-github-models");
    });

    it("prefixes the model with custom-{slug}/ (new pattern)", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.model).toBe("custom-github-models/openai/gpt-4o-mini");
    });

    it("does not double-prefix if model already starts with custom-{slug}/", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(
        env,
        upstream,
        "custom-github-models/openai/gpt-4o-mini"
      );
      expect(result.model).toBe("custom-github-models/openai/gpt-4o-mini");
    });

    it("strips and re-prefixes when model has a different custom- prefix", () => {
      // Model carries a stale prefix from a different slug; should get the correct prefix.
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      // "other-slug/openai/gpt-4o-mini" does NOT start with "custom-github-models/",
      // so it is treated as a plain upstream model and gets prefixed as-is.
      const result = resolveAiGatewayLlmConfig(
        env,
        upstream,
        "other-slug/openai/gpt-4o-mini"
      );
      expect(result.model).toBe("custom-github-models/other-slug/openai/gpt-4o-mini");
    });

    it("strips the custom-{slug}/ prefix before re-applying it (idempotent round-trip)", () => {
      // This verifies that stripCustomProviderModelPrefix is still called correctly and
      // the result only has one prefix layer.
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const alreadyPrefixed = "custom-github-models/openai/gpt-4o-mini";
      const result = resolveAiGatewayLlmConfig(env, upstream, alreadyPrefixed);
      // Should still be exactly one prefix
      expect(result.model).toBe("custom-github-models/openai/gpt-4o-mini");
      expect(result.model.split("custom-github-models/").length - 1).toBe(1);
    });

    it("adds cf-aig-authorization header when AI_GATEWAY_API_TOKEN is set with slug", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
        AI_GATEWAY_API_TOKEN: "gw-secret",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.defaultHeaders).toEqual({
        "cf-aig-authorization": "Bearer gw-secret",
      });
    });

    it("omits defaultHeaders when AI_GATEWAY_API_TOKEN is absent with slug", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.defaultHeaders).toBeUndefined();
    });

    it("handles slug with leading/trailing whitespace", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "  github-models  ",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat");
      expect(result.model).toBe("custom-github-models/openai/gpt-4o-mini");
    });

    it("strips custom- prefix from slug before building the model prefix", () => {
      // If the user sets AI_GATEWAY_PROVIDER_SLUG="custom-github-models" (with prefix),
      // slugClean="github-models" and the model should be "custom-github-models/{model}"
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "custom-github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.model).toBe("custom-github-models/openai/gpt-4o-mini");
      expect(result.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat");
    });

    it("falls back to /compat with unchanged model when slug reduces to empty after stripping", () => {
      // AI_GATEWAY_PROVIDER_SLUG="custom-" → slugClean="" after replace+trim
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "custom-",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      expect(result.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw456/compat");
      expect(result.model).toBe("openai/gpt-4o-mini");
    });
  });

  // --- Upstream credentials forwarded correctly ---
  describe("apiKey forwarding", () => {
    it("always forwards the upstream apiKey through the gateway", () => {
      const customUpstream: UpstreamLlmCredentials = {
        apiKey: "secret-upstream-key",
        baseUrl: "https://models.github.ai/inference",
      };
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, customUpstream, "openai/gpt-4o-mini");
      expect(result.apiKey).toBe("secret-upstream-key");
    });
  });

  // --- Regression: old provider-specific URL must NOT be returned for the slug path ---
  describe("regression: slug path must not use custom provider URL", () => {
    it("never returns a baseUrl containing /custom-{slug} when slug is set (old behavior removed)", () => {
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      // Old code returned …/custom-github-models; new code must return …/compat
      expect(result.baseUrl).not.toMatch(/\/custom-[^/]+$/);
      expect(result.baseUrl).toMatch(/\/compat$/);
    });

    it("never strips the upstream model segment when slug is set (old behavior removed)", () => {
      // Old code stripped "custom-github-models/" prefix from the model.
      // New code adds the prefix instead.
      const env = makeEnv({
        AI_GATEWAY_ACCOUNT_ID: "acc123",
        AI_GATEWAY_ID: "gw456",
        AI_GATEWAY_PROVIDER_SLUG: "github-models",
      });
      const result = resolveAiGatewayLlmConfig(env, upstream, "openai/gpt-4o-mini");
      // Model must start with the prefix, not be the bare upstream model
      expect(result.model).not.toBe("openai/gpt-4o-mini");
      expect(result.model).toMatch(/^custom-github-models\//);
    });
  });
});
