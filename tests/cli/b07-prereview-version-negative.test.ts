import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => ({ root: "", fetch: vi.fn() }));
vi.mock("@/cli/config", () => ({ get queuePath() { return `${fixture.root}/queue.jsonl`; }, get rejectedUsagePath() { return `${fixture.root}/rejected.jsonl`; }, get statePath() { return `${fixture.root}/state.json`; }, readCredentials: () => ({ deviceToken: "fixture" }), readDevice: () => ({ id: "fixture", name: "fixture" }) }));
vi.mock("@/cli/fetch", () => ({ agentFetch: fixture.fetch }));
vi.mock("@/cli/agent-version", () => ({ getAgentVersion: () => "test" }));
import { mergeQueueEvents, queueEventVersion, readQueue, resolveQueueEvents } from "@/cli/queue";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import * as atomic from "@/cli/atomic-file";
import { syncEvents } from "@/cli/sync";

beforeEach(() => { fixture.root = mkdtempSync(join(realpathSync(tmpdir()), "b07-independent-")); fixture.fetch.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); rmSync(fixture.root, { recursive: true, force: true }); });
function event(tokens: number, id = "same-id"): UsageEventInput { return { source: "aider", sourceEventId: id, occurredAt: "2026-10-08T00:00:00.000Z", inputTokens: tokens, totalTokens: tokens }; }
function reject(input: UsageEventInput) { return resolveQueueEvents({ accepted: [], rejected: [{ event: input, code: "invalid_event" }] }); }
function recoverableVersions() { return [...readQueue(), ...readRejectedUsageEvents().map((row) => row.event)].map(queueEventVersion); }

it("same ID corrected rejection must remain recoverable after older version was already quarantined", () => {
  const old = event(1); const corrected = event(200); mergeQueueEvents([old]); reject(old);
  expect(readQueue()).toEqual([]); expect(readRejectedUsageEvents()).toHaveLength(1);
  mergeQueueEvents([corrected]); expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(corrected)]);
  reject(corrected); console.log("QUARANTINE_VERSION_NEGATIVE", JSON.stringify({ active: readQueue(), quarantine: readRejectedUsageEvents() }));
  expect(recoverableVersions()).toContain(queueEventVersion(corrected));
});

it("two same-ID versions rejected in one response must both remain recoverable", () => {
  const versions = [event(1), event(200)]; mergeQueueEvents(versions);
  resolveQueueEvents({ accepted: [], rejected: versions.map((input) => ({ event: input, code: "invalid_event" })) });
  console.log("QUARANTINE_SAME_BATCH_NEGATIVE", JSON.stringify({ active: readQueue(), quarantine: readRejectedUsageEvents() }));
  for (const input of versions) expect(recoverableVersions()).toContain(queueEventVersion(input));
});

it("partial ACK sync end-to-end retains a newer rejected version even when old rejection is persisted", async () => {
  const old = event(1); const corrected = event(200); mergeQueueEvents([old]); reject(old); mergeQueueEvents([corrected]);
  fixture.fetch.mockResolvedValue(Response.json({ protocol: "usage-partial-v1", inserted: 0, duplicates: 0, received: 0, accepted: [], rejected: [{ row: 0, code: "invalid_event" }] }));
  const result = await syncEvents({ serverUrl: "http://127.0.0.1:9" } as Parameters<typeof syncEvents>[0], [corrected]);
  console.log("SYNC_VERSION_NEGATIVE", JSON.stringify({ result, active: readQueue(), quarantine: readRejectedUsageEvents() }));
  expect(recoverableVersions()).toContain(queueEventVersion(corrected));
});

it("failure after quarantine but before active queue commit is retryable for one version", () => {
  const input = event(1); mergeQueueEvents([input]); const original = atomic.writeFileAtomic;
  const write = vi.spyOn(atomic, "writeFileAtomic").mockImplementation((path, content, options) => { if (path.endsWith("/queue.jsonl")) throw new Error("INJECT_QUEUE_COMMIT_FAILURE"); return original(path, content, options); });
  expect(() => reject(input)).toThrow("INJECT_QUEUE_COMMIT_FAILURE"); expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(input)]); expect(readRejectedUsageEvents()).toHaveLength(1);
  write.mockRestore(); reject(input); expect(readQueue()).toEqual([]); expect(readRejectedUsageEvents()).toHaveLength(1);
});

it("commit failure then same-ID corrected rejection must retain BOTH exact versions on retry", () => {
  const old = event(1); const corrected = event(200); mergeQueueEvents([old]); const original = atomic.writeFileAtomic;
  const write = vi.spyOn(atomic, "writeFileAtomic").mockImplementation((path, content, options) => { if (path.endsWith("/queue.jsonl")) throw new Error("INJECT_QUEUE_COMMIT_FAILURE"); return original(path, content, options); });
  expect(() => reject(old)).toThrow("INJECT_QUEUE_COMMIT_FAILURE"); write.mockRestore(); mergeQueueEvents([corrected]);
  resolveQueueEvents({ accepted: [], rejected: [old, corrected].map((input) => ({ event: input, code: "invalid_event" })) });
  console.log("CRASH_CORRECTION_NEGATIVE", JSON.stringify({ active: readQueue(), quarantine: readRejectedUsageEvents() }));
  for (const input of [old, corrected]) expect(recoverableVersions()).toContain(queueEventVersion(input));
});

it("old ACK exact-version control preserves simultaneous corrected active version", () => {
  const old = event(1); const corrected = event(200); mergeQueueEvents([old, corrected]); resolveQueueEvents({ accepted: [old], rejected: [] });
  expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(corrected)]); expect(readRejectedUsageEvents()).toEqual([]);
});

it("corrupt quarantine fail-closed control retains active versions and original bytes", () => {
  const input = event(1); mergeQueueEvents([input]); const corrupt = "CORRUPT_SENTINEL\n"; writeFileSync(join(fixture.root, "rejected.jsonl"), corrupt);
  expect(() => reject(input)).toThrow(); expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(input)]); expect(readFileSync(join(fixture.root, "rejected.jsonl"), "utf8")).toBe(corrupt);
});

it("old-server rowless fallback must not discard corrected poison when old version was quarantined", async () => {
  const old = event(1); const corrected = event(200); const good = event(2, "good"); mergeQueueEvents([old]); reject(old); mergeQueueEvents([corrected, good]); const requests: UsageEventInput[][] = [];
  fixture.fetch.mockImplementation(async (_url, init: RequestInit) => {
    const batch = (JSON.parse(String(init.body)) as { events: UsageEventInput[] }).events; requests.push(batch);
    return batch.some((input) => input.inputTokens === 200) ? Response.json({ code: "invalid_json" }, { status: 400 }) : Response.json({ inserted: batch.length, duplicates: 0, received: batch.length });
  });
  const result = await syncEvents({ serverUrl: "http://127.0.0.1:9" } as Parameters<typeof syncEvents>[0], readQueue());
  console.log("ROWLESS_CORRECTION_NEGATIVE", JSON.stringify({ result, requests: requests.map((batch) => batch.map((input) => input.inputTokens)), active: readQueue(), quarantine: readRejectedUsageEvents() }));
  expect(result).toMatchObject({ received: 1, rejected: 1 }); expect(recoverableVersions()).toContain(queueEventVersion(corrected));
});

it("old-server global rowless rejection keeps active correction when the empty envelope also fails", async () => {
  const corrected = event(200); mergeQueueEvents([corrected]); fixture.fetch.mockResolvedValue(Response.json({ code: "invalid_json" }, { status: 400 }));
  await expect(syncEvents({ serverUrl: "http://127.0.0.1:9" } as Parameters<typeof syncEvents>[0], readQueue())).rejects.toThrow("Sync failed: 400 invalid_json");
  expect(fixture.fetch).toHaveBeenCalledTimes(2); expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(corrected)]); expect(readRejectedUsageEvents()).toEqual([]);
});
