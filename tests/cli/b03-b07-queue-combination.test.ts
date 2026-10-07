import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp"}/b03-b07-combination-${process.pid}`;
  return {
    queuePath: `${root}/queue.jsonl`,
    rejectedUsagePath: `${root}/rejected-usage.jsonl`,
    currentConfig: undefined as unknown
  };
});

vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath,
  readConfig: () => fixture.currentConfig
}));

import {
  acknowledgeQueuedEvents,
  mergeQueue,
  queueEventVersion,
  readQueue
} from "@/cli/collect";
import { dryRunBoundedReplay, executeBoundedReplay } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";
import { parseClaudeJsonlBuffer } from "@/parsers/claude";

const roots: string[] = [];

function event(id: string, inputTokens: number): UsageEventInput {
  return {
    source: "claude-code",
    sourceEventId: id,
    occurredAt: "2026-10-07T12:00:00.000Z",
    inputTokens,
    totalTokens: inputTokens
  };
}

beforeEach(() => {
  rmSync(fixture.queuePath.replace(/\/queue\.jsonl$/, ""), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(fixture.queuePath.replace(/\/queue\.jsonl$/, ""), { recursive: true, force: true });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("B03 replay and B07 exact-version queue combination", () => {
  it("merges by exact version and ACKs only the in-flight version", () => {
    const queue = join(mkdtempSync(join(realpathSync(tmpdir()), "b03-b07-queue-")), "queue.jsonl");
    roots.push(queue.replace(/\/queue\.jsonl$/, ""));
    const old = event("same-id", 1);
    const corrected = event("same-id", 2);
    const retained = event("retained", 3);
    const collected = event("newly-collected", 4);

    mergeQueue([old, retained], queue);
    const result = mergeQueue([corrected, collected], queue);

    expect(result.added).toBe(2);
    expect(result.events.map(queueEventVersion)).toEqual([
      old, corrected, retained, collected
    ].map(queueEventVersion));
    expect(acknowledgeQueuedEvents([old], queue).map(queueEventVersion)).toEqual([
      corrected, retained, collected
    ].map(queueEventVersion));
  });

  it("keeps queue bytes unchanged when the replay deadline guard or lock budget fails", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "b03-b07-deadline-"));
    roots.push(root);
    const queue = join(root, "queue.jsonl");
    mergeQueue([event("retained", 1)], queue);
    const before = readFileSync(queue, "utf8");

    expect(() => mergeQueue([event("must-not-land", 2)], queue, {
      timeoutMs: 100,
      beforeMutate: () => { throw new Error("Replay refused: queue admission exceeded 10000ms deadline"); }
    })).toThrow("queue admission exceeded");
    expect(readFileSync(queue, "utf8")).toBe(before);

    writeFileSync(`${queue}.lock`, "live-lock");
    expect(() => mergeQueue([event("also-must-not-land", 3)], queue, { timeoutMs: 20 })).toThrow(/Timed out/);
    expect(readFileSync(queue, "utf8")).toBe(before);
  });

  it("uses the production replay merge without deleting a queued same-ID correction", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "b03-b07-replay-"));
    roots.push(root);
    const file = join(root, "source.jsonl");
    const row = {
      type: "assistant",
      uuid: "historical-one",
      cwd: root,
      timestamp: "2026-10-07T12:00:00.000Z",
      message: { role: "assistant", id: "historical-one", usage: { input_tokens: 1 } }
    };
    const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
    writeFileSync(file, bytes);
    const config = {
      serverUrl: "http://127.0.0.1:9",
      projectRoots: [],
      sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
      privacy: { mode: "local-only" as const, includePaths: [root], excludePaths: [] }
    };
    fixture.currentConfig = config;
    const request = {
      source: "claude-code",
      file,
      from: "2026-10-07T00:00:00.000Z",
      to: "2026-10-08T00:00:00.000Z",
      maxBytes: 100_000,
      maxEvents: 10
    };
    const parsed = parseClaudeJsonlBuffer({ file, bytes, mtime: new Date(row.timestamp), projectRoots: [] }).events[0];
    mergeQueue([{ ...parsed, inputTokens: 99, totalTokens: 99 }]);

    const preview = dryRunBoundedReplay(planBoundedReplay(request), config);
    const executed = executeBoundedReplay(
      planBoundedReplay({ ...request, dryRun: false }),
      config,
      preview.planDigest
    );
    const sameId = readQueue().filter((item) => item.source === parsed.source && item.sourceEventId === parsed.sourceEventId);

    expect(executed).toMatchObject({ admitted: 1, duplicates: 0, backlog: 2 });
    expect(sameId.map((item) => item.inputTokens)).toEqual([99, 1]);
  });
});
