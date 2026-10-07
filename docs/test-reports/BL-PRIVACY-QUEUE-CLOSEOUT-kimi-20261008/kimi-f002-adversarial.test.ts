// Independent F002 adversarial controls (Kimi evaluator, batch BL-PRIVACY-QUEUE-CLOSEOUT).
// Derived from docs/specs/BL-PRIVACY-QUEUE-CLOSEOUT-spec.md regression controls 1-7.
// Only @/cli/config path constants are redirected; every exercised code path is real.
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  const root = `${tmp}/kf2-unit-${process.pid}`;
  return {
    root,
    queuePath: `${root}/state/queue.jsonl`,
    rejectedUsagePath: `${root}/state/rejected-usage.jsonl`
  };
});

vi.mock("@/cli/config", async (importActual) => {
  const actual = await importActual<typeof import("@/cli/config")>();
  return { ...actual, queuePath: fixture.queuePath, rejectedUsagePath: fixture.rejectedUsagePath };
});

import { acknowledgeQueuedEvents, mergeQueue, queueEventVersion, readQueue, resolveQueueEvents } from "@/cli/collect";
import { readRejectedUsageEvents } from "@/cli/rejected-events";
import { dryRunBoundedReplay, executeBoundedReplay, readBoundedReplayFile } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import type { TokenizerConfig } from "@/cli/config";

function event(id: string, inputTokens = 1, occurredAt = "2026-10-07T12:00:00.000Z"): UsageEventInput {
  return { source: "aider", sourceEventId: id, occurredAt, inputTokens };
}
function cfg(includePaths: string[] = [], excludePaths: string[] = []): TokenizerConfig {
  return {
    serverUrl: "http://127.0.0.1:9",
    projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths, excludePaths }
  };
}
function claudeRow(cwd: string, id: string): string {
  return JSON.stringify({
    type: "assistant", uuid: id, cwd, timestamp: "2026-10-07T12:00:00.000Z",
    message: { role: "assistant", id, usage: { input_tokens: 1, output_tokens: 2 } }
  }) + "\n";
}
function plan(file: string, dryRun = true) {
  return planBoundedReplay({
    source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z",
    maxBytes: 100_000, maxEvents: 10, dryRun
  });
}

const replayRoots: string[] = [];
function replayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kf2-replay-"));
  replayRoots.push(dir);
  return dir;
}

beforeEach(() => {
  rmSync(fixture.queuePath, { force: true });
  rmSync(fixture.rejectedUsagePath, { force: true });
});
afterEach(() => {
  for (const dir of replayRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(fixture.root, { recursive: true, force: true });
});

describe("control 1+4: merge retains backlog and every exact version of one ID", () => {
  it("keeps an existing correction when an older historical version is admitted", () => {
    mergeQueue([event("legacy"), event("same-id", 2)]); // correction already collected
    const before = readFileSync(fixture.queuePath, "utf8");
    const merged = mergeQueue([event("same-id", 1), event("fresh")]); // older historical version admitted later
    expect(merged.added).toBe(2);
    const versions = readQueue().map(queueEventVersion);
    expect(versions).toHaveLength(4);
    for (const expected of [event("legacy"), event("same-id", 1), event("same-id", 2), event("fresh")]) {
      expect(versions).toContain(queueEventVersion(expected));
    }
    // Identity group keeps its first-seen position: legacy row still leads the file.
    expect(readFileSync(fixture.queuePath, "utf8").startsWith(before.split("\n")[0] + "\n")).toBe(true);
  });

  it("dedupes a byte-identical re-merge (idempotent collection)", () => {
    mergeQueue([event("dup", 7)]);
    const again = mergeQueue([event("dup", 7)]);
    expect(again.added).toBe(0);
    expect(readQueue()).toHaveLength(1);
  });
});

describe("control 2: ACK removes only the exact acknowledged version", () => {
  it("survives concurrent corrections and unrelated rows", () => {
    mergeQueue([event("same-id", 1), event("same-id", 2), event("other")]);
    resolveQueueEvents({ accepted: [event("same-id", 1)], rejected: [] });
    const remaining = readQueue().map(queueEventVersion);
    expect(remaining).toEqual([queueEventVersion(event("same-id", 2)), queueEventVersion(event("other"))]);
  });

  it("is idempotent when the same ACK is replayed (acknowledgeQueuedEvents)", () => {
    mergeQueue([event("a"), event("b")]);
    acknowledgeQueuedEvents([event("a")]);
    const once = readFileSync(fixture.queuePath, "utf8");
    acknowledgeQueuedEvents([event("a"), event("gone")]); // replay of a stale ACK set
    expect(readFileSync(fixture.queuePath, "utf8")).toBe(once);
    expect(readQueue().map((row) => row.sourceEventId)).toEqual(["b"]);
  });
});

describe("control 3: guard failure under lock and lock timeout", () => {
  it("leaves queue bytes unchanged when beforeMutate throws", () => {
    mergeQueue([event("stable")]);
    const before = readFileSync(fixture.queuePath, "utf8");
    expect(() => mergeQueue([event("poison")], fixture.queuePath, {
      beforeMutate: () => { throw new Error("deadline exceeded"); }
    })).toThrow(/deadline exceeded/);
    expect(readFileSync(fixture.queuePath, "utf8")).toBe(before);
    expect(existsSync(`${fixture.queuePath}.lock`)).toBe(false); // lock released on throw
  });

  it("honors a supplied lock timeout and recovers after the holder exits", () => {
    const lock = `${fixture.queuePath}.lock`;
    mkdirSync(join(fixture.root, "state"), { recursive: true });
    writeFileSync(lock, "foreign-holder");
    const started = Date.now();
    expect(() => mergeQueue([event("x")], fixture.queuePath, { timeoutMs: 400 })).toThrow(/Timed out after 400ms/);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(4_000); // did not fall through to the 5s default
    rmSync(lock, { force: true });
    mergeQueue([event("x")], fixture.queuePath, { timeoutMs: 400 });
    expect(readQueue().map((row) => row.sourceEventId)).toEqual(["x"]);
  });
});

describe("control 5: same-ID distinct rejected versions are both durable; idempotent resolution", () => {
  it("quarantines v1 and v2 of one ID as separate rows; replays do not duplicate", () => {
    mergeQueue([event("same-id", 1)]);
    resolveQueueEvents({ accepted: [], rejected: [{ event: event("same-id", 1), code: "invalid_event" }] });
    expect(readRejectedUsageEvents()).toHaveLength(1);

    mergeQueue([event("same-id", 2)]); // a NEW correction of the same ID is rejected later
    resolveQueueEvents({ accepted: [], rejected: [{ event: event("same-id", 2), code: "invalid_event" }] });
    const rows = readRejectedUsageEvents();
    expect(rows).toHaveLength(2); // the prior same-ID row must not suppress the new version
    expect(rows.map((row) => row.event.inputTokens).sort()).toEqual([1, 2]);
    expect(readQueue()).toHaveLength(0);

    // Replay both resolutions: no new rows, no error, queue untouched.
    resolveQueueEvents({ accepted: [], rejected: [
      { event: event("same-id", 1), code: "invalid_event" },
      { event: event("same-id", 2), code: "invalid_event" }
    ] });
    expect(readRejectedUsageEvents()).toHaveLength(2);
    expect(readQueue()).toHaveLength(0);
  });
});

describe("privacy: owner-only queue/quarantine artifacts", () => {
  it("creates 0o600 files inside a 0o700 state directory", () => {
    mergeQueue([event("private")]);
    resolveQueueEvents({ accepted: [], rejected: [{ event: event("private"), code: "invalid_event" }] });
    expect(statSync(fixture.queuePath).mode & 0o777).toBe(0o600);
    expect(statSync(fixture.rejectedUsagePath).mode & 0o777).toBe(0o600);
    expect(statSync(join(fixture.root, "state")).mode & 0o777).toBe(0o700);
    const quarantine = readFileSync(fixture.rejectedUsagePath, "utf8");
    expect(quarantine).not.toMatch(/PRIVATE/);
  });
});

describe("control 6: replay physical admission negatives (freshly derived)", () => {
  it("rejects a symlinked source leaf", () => {
    const dir = replayDir();
    const real = join(dir, "real.jsonl");
    writeFileSync(real, claudeRow(dir, "a"));
    const alias = join(dir, "alias.jsonl");
    symlinkSync(real, alias);
    expect(() => dryRunBoundedReplay(plan(alias), cfg())).toThrow(/regular non-symlink/);
  });

  it("rejects a symlinked parent directory", () => {
    const dir = replayDir();
    const real = join(dir, "real");
    mkdirSync(real);
    writeFileSync(join(real, "source.jsonl"), claudeRow(dir, "a"));
    const alias = join(dir, "alias");
    symlinkSync(real, alias, "dir");
    expect(() => dryRunBoundedReplay(plan(join(alias, "source.jsonl")), cfg())).toThrow(/non-symlink directory/);
  });

  it("rejects dot-segment traversal even though the literal path resolves", () => {
    const dir = replayDir();
    const file = join(dir, "source.jsonl");
    writeFileSync(file, claudeRow(dir, "a"));
    const withDot = `${dir}/../${dir.split("/").pop()!}/source.jsonl`;
    expect(withDot).toContain("/../");
    expect(() => dryRunBoundedReplay(plan(withDot), cfg()))
      .toThrow(/dot traversal/);
  });

  it("rejects a FIFO source (not a regular file)", () => {
    const dir = replayDir();
    const fifo = join(dir, "source.jsonl");
    execSync(`mkfifo ${JSON.stringify(fifo)}`);
    expect(() => readBoundedReplayFile(fifo, 100_000)).toThrow(/regular non-symlink/);
  });

  it("rejects relative paths and non-.jsonl / glob scopes at plan time", () => {
    expect(() => plan("relative/source.jsonl")).toThrow(/absolute literal/);
    expect(() => plan("/tmp/*.jsonl")).toThrow(/never a directory or glob/);
    expect(() => plan("/tmp/source.txt")).toThrow(/\.jsonl/);
  });

  it("rejects a forged or stale confirmation digest without touching the queue", () => {
    const dir = replayDir();
    const file = join(dir, "source.jsonl");
    writeFileSync(file, claudeRow(dir, "hist-1"));
    const config = cfg();
    const preview = dryRunBoundedReplay(plan(file), config);
    expect(preview.wouldAdmit).toBe(1);
    expect(() => executeBoundedReplay(plan(file, false), config, "0".repeat(64)))
      .toThrow(/does not match/);
    expect(() => executeBoundedReplay(plan(file, false), config, "not-a-digest"))
      .toThrow(/exact lowercase SHA-256/);
    expect(readQueue()).toHaveLength(0);
    // Mutate the source after preview: confirmation must go stale.
    writeFileSync(file, claudeRow(dir, "hist-1") + claudeRow(dir, "hist-2"));
    expect(() => executeBoundedReplay(plan(file, false), config, preview.planDigest))
      .toThrow(/does not match|became stale/);
    expect(readQueue()).toHaveLength(0);
  });

  it("rejects execution when the privacy scope changes after preview", () => {
    const dir = replayDir();
    const file = join(dir, "source.jsonl");
    writeFileSync(file, claudeRow(dir, "hist-1"));
    const preview = dryRunBoundedReplay(plan(file), cfg([dir]));
    expect(() => executeBoundedReplay(plan(file, false), cfg([dir]), preview.planDigest, {
      readCurrentConfig: () => cfg([join(dir, "elsewhere")])
    })).toThrow(/scope or mode changed|does not match|became stale/);
    expect(readQueue()).toHaveLength(0);
  });
});

describe("control 1+4 on the REAL replay path: executeBoundedReplay into the shared queue", () => {
  it("retains pre-existing backlog and a concurrent correction of the replayed ID", () => {
    const dir = replayDir();
    const file = join(dir, "source.jsonl");
    writeFileSync(file, claudeRow(dir, "hist-1"));
    const config = cfg();
    // Pre-existing backlog: an unrelated legacy row and a newer correction of hist-1.
    const correction = { source: "claude-code", sourceEventId: "hist-1",
      occurredAt: "2026-10-07T12:00:00.000Z", inputTokens: 99, outputTokens: 2 } as UsageEventInput;
    mergeQueue([event("legacy-backlog"), correction]);
    const preview = dryRunBoundedReplay(plan(file), config);
    const result = executeBoundedReplay(plan(file, false), config, preview.planDigest, {
      readCurrentConfig: () => config
    });
    expect(result.admitted).toBe(1);
    const versions = readQueue().map(queueEventVersion);
    expect(versions).toHaveLength(3); // backlog + correction + replayed historical version
    expect(versions).toContain(queueEventVersion(correction));
    expect(versions).toContain(queueEventVersion(event("legacy-backlog")));
    // Re-executing the identical confirmed snapshot admits nothing new (idempotent).
    const again = executeBoundedReplay(plan(file, false), config, preview.planDigest, {
      readCurrentConfig: () => config
    });
    expect(again.admitted).toBe(0);
    expect(readQueue()).toHaveLength(3);
  });
});
