import { describe, expect, it } from "vitest";
import { codexCanonicalSourceEventId } from "@/shared/codex-usage";
import { minimizeUsageEvent } from "@/shared/usage-privacy";
import type { UsageEventInput } from "@/shared/usage";

const canary = "PRIVATE_BODY_TOOL_URL_TOKEN_CANARY";

function event(source: UsageEventInput["source"], rawJson: unknown): UsageEventInput {
  return {
    source,
    sourceEventId: "event-1",
    sessionId: "sess-1",
    model: "model-1",
    inputTokens: 100,
    outputTokens: 20,
    fallbackFromModel: "model-0",
    occurredAt: "2026-01-01T00:00:00.000Z",
    rawJson
  };
}

describe("usage event minimization", () => {
  it.each(["claude-code", "opencode", "aider", "kimicode"] as const)(
    "discards %s raw content while retaining correction scalars",
    (source) => {
      const minimized = minimizeUsageEvent({ ...event(source, { content: canary }), extraBody: canary } as UsageEventInput);
      expect(minimized).not.toHaveProperty("rawJson");
      expect(minimized).not.toHaveProperty("extraBody");
      expect(minimized).toMatchObject({ inputTokens: 100, outputTokens: 20, fallbackFromModel: "model-0" });
      expect(JSON.stringify(minimized)).not.toContain(canary);
    }
  );

  it("retains only Codex cumulative counters required for legacy ID canonicalization", () => {
    const oldRaw = {
      payload: {
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 30,
            cache_write_input_tokens: 7,
            output_tokens: 20,
            reasoning_output_tokens: 5,
            total_tokens: 120,
            secret: canary
          },
          last_token_usage: { content: canary }
        },
        tool_arguments: canary
      },
      content: canary
    };
    const minimized = minimizeUsageEvent(event("codex", oldRaw));
    expect(JSON.stringify(minimized)).not.toContain(canary);
    expect(minimized.rawJson).toEqual({ payload: { info: { total_token_usage: {
      input_tokens: 100,
      cached_input_tokens: 30,
      cache_write_input_tokens: 7,
      output_tokens: 20,
      reasoning_output_tokens: 5,
      total_tokens: 120
    } } } });
    expect(codexCanonicalSourceEventId(minimized.sessionId, minimized.rawJson, "legacy")).toBe("codex:v2:sess-1:100:30:7:20:5:120");
  });
});
