import { readFileSync, rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { UsageEventInput } from "../../src/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return { queuePath: `${tmp}/b06-queue-${process.pid}.jsonl`, statePath: `${tmp}/b06-state-${process.pid}.json`, fetch: vi.fn() };
});
vi.mock("@/cli/config", () => ({ queuePath: fixture.queuePath, statePath: fixture.statePath, readCredentials: () => ({ deviceToken: "synthetic" }), readDevice: () => ({ id: "device-a", name: "Legacy" }) }));
vi.mock("@/cli/fetch", () => ({ agentFetch: fixture.fetch }));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));
import { syncEvents, readQueue } from "../../src/cli/sync";
import { writeQueue } from "../../src/cli/collect";

afterEach(() => { vi.useRealTimers(); rmSync(fixture.queuePath, { force: true }); });
it("retains the complete durable mixed queue on whole-batch 400, without an ACK callback or silent row loss", async () => {
  vi.useFakeTimers();
  fixture.fetch.mockImplementation(async () => Response.json({ error: "invalid batch request", code: "invalid_event", row: 1 }, { status: 400 }));
  const good: UsageEventInput = { source: "aider", sourceEventId: "good", occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 1 };
  const poison = { ...good, source: "unknown", sourceEventId: "poison" } as unknown as UsageEventInput;
  writeQueue([good, poison]);
  const before = readFileSync(fixture.queuePath, "utf8");
  const onBatchSynced = vi.fn();
  const outcome = syncEvents({ serverUrl: "https://example.test" } as Parameters<typeof syncEvents>[0], readQueue(), { onBatchSynced }).catch((error: Error) => error);
  await vi.runAllTimersAsync();
  expect(await outcome).toMatchObject({ message: expect.stringContaining("Sync failed: 400") });
  expect(fixture.fetch).toHaveBeenCalledTimes(3);
  expect(onBatchSynced).not.toHaveBeenCalled();
  expect(readFileSync(fixture.queuePath, "utf8")).toBe(before);
  expect(readQueue().map((row) => row.sourceEventId)).toEqual(["good", "poison"]);
});
