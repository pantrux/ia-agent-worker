import { describe, expect, it } from "vitest";
import {
  parseNormalizedChatPayload,
  resolveThreadIdFromHint,
  parseThreadId,
  buildChatLangSmithMetadata,
  buildChatLangSmithTags,
} from "./chat-queue-payload.js";

describe("parseNormalizedChatPayload", () => {
  it("acepta payload válido", () => {
    const r = parseNormalizedChatPayload({
      channel: "slack",
      user_id: "U123",
      text: "hola",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.channel).toBe("slack");
      expect(r.data.user_id).toBe("U123");
      expect(r.data.text).toBe("hola");
      expect(r.data.thread_hint).toBeUndefined();
    }
  });

  it("rechaza text vacío", () => {
    const r = parseNormalizedChatPayload({
      channel: "web",
      user_id: "u",
      text: "   ",
    });
    expect(r.ok).toBe(false);
  });
});

describe("resolveThreadIdFromHint", () => {
  it("usa UUID v4 válido como thread", () => {
    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    expect(resolveThreadIdFromHint(id)).toBe(id);
  });

  it("genera UUID si hint no es válido", () => {
    const a = resolveThreadIdFromHint("not-a-uuid");
    const b = resolveThreadIdFromHint("not-a-uuid");
    expect(parseThreadId(a)).not.toBeNull();
    expect(parseThreadId(b)).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it("genera UUID si no hay hint", () => {
    const id = resolveThreadIdFromHint(undefined);
    expect(parseThreadId(id)).toBe(id);
  });
});

describe("buildChatLangSmithMetadata y tags", () => {
  it("incluye channel y user_id", () => {
    const meta = buildChatLangSmithMetadata({
      threadId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      channel: "teams",
      userId: "user-1",
      operation: "queue_chat",
      deploymentEnv: "preview",
    });
    expect(meta.channel).toBe("teams");
    expect(meta.user_id).toBe("user-1");
    expect(meta.thread_id).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(meta.operation).toBe("queue_chat");
    expect(meta.deployment).toBe("preview");
    expect(meta.runtime).toBe("cloudflare-worker");
  });

  it("tags incluyen prefijo channel:", () => {
    const tags = buildChatLangSmithTags(["env:preview"], "slack");
    expect(tags).toContain("channel:slack");
    expect(tags).toContain("langsmith");
    expect(tags).toContain("env:preview");
  });
});
