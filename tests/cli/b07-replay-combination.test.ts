import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@/cli/config", () => ({
  get queuePath() { return join(fixture.root, "queue.jsonl"); },
  get rejectedUsagePath() { return join(fixture.root, "rejected.jsonl"); }
}));

import * as atomic from "@/cli/atomic-file";
import { mergeQueue as collectMerge } from "@/cli/collect";
import { enrichEventsWithGit } from "@/cli/git";
import { acknowledgeQueuedEvents, mergeQueue, queueEventVersion, readQueue, resolveQueueEvents } from "@/cli/queue";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import { dryRunBoundedReplay, executeBoundedReplay } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import { parseClaudeJsonlBuffer } from "@/parsers/claude";

const event = (id: string, inputTokens = 1): UsageEventInput => ({
  source: "claude-code", sourceEventId: id,
  occurredAt: "2026-10-07T12:00:00.000Z", inputTokens
});
const versions = (events: UsageEventInput[]) => events.map(queueEventVersion).sort();

beforeEach(() => { fixture.root = mkdtempSync(join(realpathSync(tmpdir()), "b07-replay-combination-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(fixture.root, { recursive: true, force: true }); });

describe("B03 replay with B07 shared exact-version queue", () => {
  it("shares one primitive and retains old backlog plus distinct corrected versions", () => {
    expect(collectMerge).toBe(mergeQueue);
    const backlog = { ...event("old-backlog"), workspacePath: "/previously-admitted" };
    const old = event("same-id", 1);
    const correction = event("same-id", 200);
    mergeQueue([backlog, correction]);
    const merged = collectMerge([old, old]);
    expect(merged.added).toBe(1);
    expect(versions(merged.events)).toEqual(versions([backlog, correction, old]));
    expect(collectMerge([old, correction]).added).toBe(0);
    mergeQueue([event("newly-collected")]);
    expect(versions(acknowledgeQueuedEvents([old]))).toEqual(versions([backlog, correction, event("newly-collected")]));
    expect(versions(acknowledgeQueuedEvents([old]))).toEqual(versions([backlog, correction, event("newly-collected")]));
  });

  it("checks beforeMutate under the shared lock and leaves original bytes on guard failure", () => {
    const path = join(fixture.root, "custom.jsonl");
    mergeQueue([event("retained")], path);
    const before = readFileSync(path);
    expect(() => mergeQueue([event("new")], path, { beforeMutate: () => {
      expect(existsSync(`${path}.lock`)).toBe(true);
      throw new Error("synthetic expired replay deadline");
    } })).toThrow("synthetic expired replay deadline");
    expect(readFileSync(path)).toEqual(before);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("honors the supplied bounded lock timeout instead of the default five seconds", () => {
    const path = join(fixture.root, "custom.jsonl");
    mergeQueue([event("retained")], path);
    const before = readFileSync(path);
    writeFileSync(`${path}.lock`, "synthetic live lock");
    const started = performance.now();
    expect(() => mergeQueue([event("new")], path, { timeoutMs: 45 }))
      .toThrow("Timed out after 45ms waiting for lock");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(readFileSync(path)).toEqual(before);
  });

  it("production replay merge preserves a corrected version when admitting confirmed older history", () => {
    const file = join(fixture.root, "source.jsonl");
    const bytes = Buffer.from(JSON.stringify({
      type: "assistant", uuid: "one", cwd: fixture.root, timestamp: "2026-10-07T12:00:00.000Z",
      message: { role: "assistant", id: "one", usage: { input_tokens: 1 } }
    }) + "\n");
    writeFileSync(file, bytes);
    const config = {
      serverUrl: "http://127.0.0.1:9", projectRoots: [],
      sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
      privacy: { mode: "local-only" as const, includePaths: [fixture.root], excludePaths: [] }
    };
    const request = {
      source: "claude-code", file, from: "2026-10-07T00:00:00.000Z",
      to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10
    };
    const historical = enrichEventsWithGit(parseClaudeJsonlBuffer({ file, bytes, mtime: new Date(), projectRoots: [] }).events)[0];
    const correction = { ...historical, inputTokens: 200 };
    const backlog = { ...event("retained"), workspacePath: "/not-currently-included" };
    mergeQueue([backlog, correction]);
    const cursor = join(fixture.root, "cursor.json");
    writeFileSync(cursor, "normal cursor sentinel\n");
    const preview = dryRunBoundedReplay(planBoundedReplay(request), config);
    const execute = () => executeBoundedReplay(
      planBoundedReplay({ ...request, dryRun: false }), config, preview.planDigest,
      { readCurrentConfig: () => config }
    );
    expect(execute()).toMatchObject({ admitted: 1, duplicates: 0, backlog: 3 });
    expect(versions(readQueue())).toEqual(versions([backlog, correction, historical]));
    expect(execute()).toMatchObject({ admitted: 0, duplicates: 1, backlog: 3 });
    expect(readFileSync(cursor, "utf8")).toBe("normal cursor sentinel\n");
    expect(versions(acknowledgeQueuedEvents([historical]))).toEqual(versions([backlog, correction]));
  });

  it("normalizes exact-version keys across raw payloads, remote credentials and field order", () => {
    const first = { ...event("normalized"), gitRemote: "https://reader:SECRET@git.example/team/repo.git", rawJson: { text: "PRIVATE" } };
    const second = { inputTokens: 1, occurredAt: first.occurredAt, sourceEventId: first.sourceEventId, source: first.source, gitRemote: "https://git.example/team/repo.git" };
    expect(queueEventVersion(first)).toBe(queueEventVersion(second));
    expect(mergeQueue([first, second]).added).toBe(1);
    expect(readFileSync(join(fixture.root, "queue.jsonl"), "utf8")).not.toMatch(/SECRET|PRIVATE/);
    expect(acknowledgeQueuedEvents([second])).toEqual([]);
  });

  it("quarantine write failure leaves every exact active version and original bytes recoverable", () => {
    const old = event("same-id", 1);
    const correction = event("same-id", 200);
    mergeQueue([old, correction]);
    const path = join(fixture.root, "queue.jsonl");
    const before = readFileSync(path);
    const write = atomic.writeFileAtomic;
    vi.spyOn(atomic, "writeFileAtomic").mockImplementation((target, content, options) => {
      if (target.endsWith("rejected.jsonl")) throw new Error("synthetic quarantine ENOSPC");
      write(target, content, options);
    });
    const rejected = [old, correction].map((input) => ({ event: input, code: "invalid_event" }));
    expect(() => resolveQueueEvents({ accepted: [], rejected })).toThrow("synthetic quarantine ENOSPC");
    expect(readFileSync(path)).toEqual(before);
    expect(readRejectedUsageEvents()).toEqual([]);
    vi.restoreAllMocks();
    resolveQueueEvents({ accepted: [], rejected });
    resolveQueueEvents({ accepted: [], rejected });
    expect(readQueue()).toEqual([]);
    expect(versions(readRejectedUsageEvents().map((row) => row.event))).toEqual(versions([old, correction]));
  });
});
