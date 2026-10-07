import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { codexChatgptProvider } from "../../src/quota/codex-chatgpt";
import { validateQuotaBatch, validateUsageBatch } from "../../src/server/batch-input";
import { minimizeUsageEvent } from "../../src/shared/usage-privacy";
import type { BatchUsageRequest } from "../../src/shared/usage";

vi.mock("@/quota/auth-file", () => ({ readCodexAuthFile: () => ({ tokens: { accessToken: "synthetic-only" } }) }));
afterEach(() => vi.unstubAllGlobals());

it("accepts actual quota provider output in the old Agent's device-less JSON wire envelope", async () => {
  const fixture = readFileSync(new URL("../fixtures/codex-chatgpt-response.json", import.meta.url), "utf8");
  const fetch = vi.fn(async () => new Response(fixture, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const result = await codexChatgptProvider.fetch();
  expect(fetch).toHaveBeenCalledOnce();
  expect(result.error).toBeUndefined();
  const body = JSON.parse(JSON.stringify({ snapshots: result.snapshots }));
  expect(validateQuotaBatch(body)).toEqual(body);
  expect(body.device).toBeUndefined();
  expect(body.snapshots.find((s: { windowKey: string }) => s.windowKey === "rate_limit_primary").utilization).toBe(0.355);
});

it("accepts the current usage wire's privacy minimizer and legacy nullable diagnostics without changing identity", () => {
  const body: BatchUsageRequest = {
    device: { id: "legacy-device", name: "Legacy", hostname: null, platform: null, metadata: { createdAt: "2026-10-07T12:00:00.000Z" }, diagnostics: { agentVersion: null, agentReleaseVersion: null, agentFeatureVersion: null, queueDepth: 0, lastError: null, lastSyncStatus: null } },
    timezone: "UTC",
    events: [minimizeUsageEvent({ source: "codex", sourceEventId: "legacy-id", occurredAt: "2026-10-07T12:00:00.000Z", model: null, costUsd: null, inputTokens: 2, outputTokens: 3, rawJson: { payload: { info: { total_token_usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }, content: "private-canary" } })]
  };
  const wire = JSON.parse(JSON.stringify(body));
  expect(validateUsageBatch(wire)).toEqual(wire);
  expect(wire.events[0].sourceEventId).toBe("legacy-id");
  expect(JSON.stringify(wire)).not.toContain("private-canary");
});
