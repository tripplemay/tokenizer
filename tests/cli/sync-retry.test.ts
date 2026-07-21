import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fetchMock = vi.hoisted(() => vi.fn());
// Windows has no "/tmp"; a hardcoded POSIX path would resolve to the current
// drive root and fail. Read the env directly — vi.hoisted runs before imports,
// so node:os isn't available here.
const tmp = vi.hoisted(() => {
  const dir = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return {
    queuePath: `${dir}/tokenizer-test-queue.jsonl`,
    statePath: `${dir}/tokenizer-test-state.json`
  };
});
vi.mock("@/cli/fetch", () => ({ agentFetch: fetchMock }));
vi.mock("@/cli/config", () => ({
  queuePath: tmp.queuePath,
  statePath: tmp.statePath,
  readCredentials: () => ({ deviceToken: "tok" }),
  readDevice: () => ({ id: "dev-1", name: "Test Device" })
}));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));

import { syncEvents } from "@/cli/sync";

const config = { serverUrl: "https://example.test" } as Parameters<typeof syncEvents>[0];

function event(id: number): UsageEventInput {
  return {
    source: "claude-code",
    sourceEventId: `evt-${id}`,
    occurredAt: "2026-07-03T00:00:00.000Z",
    inputTokens: 1,
    outputTokens: 1
  };
}

function okResponse(inserted: number) {
  return {
    ok: true,
    json: () => Promise.resolve({ inserted, duplicates: 0, received: inserted, deviceId: "dev-1" })
  };
}

describe("syncEvents batch retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("retries a transiently failing batch instead of aborting the whole run", async () => {
    // 400+ events → two batches. The second batch fails once at the network
    // level (proxy blip), then succeeds; the run must complete without
    // surfacing the transient error. Re-sending a batch is idempotent
    // server-side (skipDuplicates + compare-equal corrections).
    const events = Array.from({ length: 250 }, (_, i) => event(i));
    fetchMock
      .mockResolvedValueOnce(okResponse(200))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse(50));

    const pending = syncEvents(config, events);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.inserted).toBe(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting batch retries", async () => {
    const events = Array.from({ length: 250 }, (_, i) => event(i));
    fetchMock.mockResolvedValueOnce(okResponse(200)).mockRejectedValue(new TypeError("fetch failed"));

    const pending = syncEvents(config, events);
    // Silence the expected rejection before advancing timers so Node does not
    // flag it as unhandled mid-flight.
    const outcome = pending.catch((error: Error) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;

    expect(error).toBeInstanceOf(TypeError);
    // 1 initial attempt + 2 retries for the failing batch, after 1 successful batch.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
