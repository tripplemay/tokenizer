import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseClaudeJsonlBuffer, parseClaudeUsage } from "@/parsers/claude";
import { planBoundedReplay } from "@/cli/replay-contract";
import {
  dryRunBoundedReplay,
  executeBoundedReplay,
  readBoundedReplayFile
} from "@/cli/replay";
import type { TokenizerConfig } from "@/cli/config";
import type { UsageEventInput } from "@/shared/usage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "tokenizer-bounded-replay-"));
  roots.push(root);
  return root;
}

function row(id: string, timestamp: string, cwd = "/allowed/project", usage = { input_tokens: 10, output_tokens: 5 }): string {
  return JSON.stringify({
    type: "assistant",
    uuid: id,
    cwd,
    timestamp,
    sessionId: "explicit-session",
    message: { role: "assistant", id: `message-${id}`, model: "claude-test", usage }
  }) + "\n";
}

function config(mode: "sync" | "local-only" | "paused" = "local-only", includePaths = ["/allowed"]): TokenizerConfig {
  return {
    serverUrl: "https://replay.invalid",
    projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode, includePaths, excludePaths: [] }
  };
}

function plan(file: string, dryRun = true, overrides: Record<string, unknown> = {}) {
  return planBoundedReplay({
    source: "claude-code",
    file,
    from: "2026-10-07T00:00:00.000Z",
    to: "2026-10-08T00:00:00.000Z",
    maxBytes: 1024 * 1024,
    maxEvents: 100,
    dryRun,
    ...overrides
  });
}

describe("bounded historical replay", () => {
  it("uses the explicit buffer adapter while preserving normal Claude event IDs", () => {
    const home = temporaryRoot();
    const dir = join(home, ".claude", "projects", "one");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "session.jsonl");
    writeFileSync(file, row("same", "2026-10-07T12:00:00.000Z"));

    const normal = parseClaudeUsage({ homeDir: home, projectRoots: [] });
    const explicit = parseClaudeJsonlBuffer({
      file,
      bytes: readFileSync(file),
      mtime: new Date("2026-10-07T12:00:00.000Z"),
      projectRoots: []
    });

    expect(explicit.events.map((event) => event.sourceEventId)).toEqual(
      normal.events.map((event) => event.sourceEventId)
    );
  });

  it("does not discover or open unselected sibling JSONL files", () => {
    const root = temporaryRoot();
    const selected = join(root, "selected.jsonl");
    writeFileSync(selected, row("selected", "2026-10-07T12:00:00.000Z"));
    writeFileSync(join(root, "unselected.jsonl"), "{".repeat(2 * 1024 * 1024));

    expect(dryRunBoundedReplay(plan(selected), config())).toMatchObject({ parsed: 1, selected: 1, wouldAdmit: 1 });
  });

  it("applies strict [from,to), event budget, and current admission scope", () => {
    const root = temporaryRoot();
    const file = join(root, "selected.jsonl");
    writeFileSync(file,
      row("before", "2026-10-06T23:59:59.999Z") +
      row("from", "2026-10-07T00:00:00.000Z") +
      row("excluded", "2026-10-07T12:00:00.000Z", "/denied/project") +
      row("before-to", "2026-10-07T23:59:59.999Z") +
      row("to", "2026-10-08T00:00:00.000Z")
    );

    const result = dryRunBoundedReplay(plan(file), config(), 2);
    expect(result).toMatchObject({ parsed: 5, selected: 3, filtered: 1, wouldAdmit: 2 });
    expect(result.sample).toHaveLength(2);
    expect(JSON.stringify(result.sample)).not.toContain("/allowed");
    expect(JSON.stringify(result.sample)).not.toContain("sourceEventId");
    expect(() => dryRunBoundedReplay(plan(file, true, { maxEvents: 2 }), config())).toThrow("event limit exceeded");
  });

  it("rejects symlinks, directories, swaps, growth, oversized input, and long records", () => {
    const root = temporaryRoot();
    const file = join(root, "source.jsonl");
    writeFileSync(file, row("one", "2026-10-07T12:00:00.000Z"));
    const link = join(root, "link.jsonl");
    symlinkSync(file, link);

    expect(() => readBoundedReplayFile(link, 1024 * 1024)).toThrow("non-symlink");
    expect(() => readBoundedReplayFile(root, 1024 * 1024)).toThrow("regular non-symlink");
    expect(() => readBoundedReplayFile(file, 1)).toThrow("byte limit exceeded");

    expect(() => readBoundedReplayFile(file, 1024 * 1024, {
      afterRead: () => appendFileSync(file, row("grown", "2026-10-07T13:00:00.000Z"))
    })).toThrow("changed while being read");

    writeFileSync(file, row("reset", "2026-10-07T12:00:00.000Z"));
    expect(() => readBoundedReplayFile(file, 1024 * 1024, {
      afterPathStat: () => {
        const replacement = join(root, "replacement.jsonl");
        writeFileSync(replacement, row("swap", "2026-10-07T12:00:00.000Z"));
        renameSync(replacement, file);
      }
    })).toThrow(/changed between path check and open|could not be opened safely/);

    const long = join(root, "long.jsonl");
    writeFileSync(long, Buffer.alloc(1024 * 1024 + 1, 0x61));
    expect(() => readBoundedReplayFile(long, 2 * 1024 * 1024)).toThrow("line exceeds");

    const records = join(root, "records.jsonl");
    writeFileSync(records, "\n".repeat(50_001));
    expect(() => readBoundedReplayFile(records, 1024 * 1024)).toThrow("physical record limit");
  });

  it("binds execution to file, range, budgets, current scope, and privacy mode", () => {
    const root = temporaryRoot();
    const file = join(root, "confirm.jsonl");
    writeFileSync(file, row("one", "2026-10-07T12:00:00.000Z"));
    const initialConfig = config("local-only");
    const preview = dryRunBoundedReplay(plan(file), initialConfig);
    const executionPlan = plan(file, false);
    const neverMerge = () => { throw new Error("merge must not run"); };

    expect(() => executeBoundedReplay(executionPlan, initialConfig, "0".repeat(64), {
      readCurrentConfig: () => initialConfig,
      mergeEvents: neverMerge
    })).toThrow("does not match");
    expect(() => executeBoundedReplay(executionPlan, initialConfig, preview.planDigest, {
      readCurrentConfig: () => config("sync"),
      mergeEvents: neverMerge
    })).toThrow("stale before queue admission");
    expect(() => executeBoundedReplay(executionPlan, initialConfig, preview.planDigest, {
      readCurrentConfig: () => config("local-only", ["/different"]),
      mergeEvents: neverMerge
    })).toThrow("stale before queue admission");

    appendFileSync(file, row("changed", "2026-10-07T13:00:00.000Z"));
    expect(() => executeBoundedReplay(executionPlan, initialConfig, preview.planDigest, {
      readCurrentConfig: () => initialConfig,
      mergeEvents: neverMerge
    })).toThrow("does not match");
  }, 30_000);

  it("merges idempotently into retained backlog and never changes normal cursors", () => {
    const root = temporaryRoot();
    const file = join(root, "execute.jsonl");
    const cursor = join(root, "cursor.json");
    writeFileSync(file, row("one", "2026-10-07T12:00:00.000Z"));
    writeFileSync(cursor, "cursor sentinel\n");
    const currentConfig = config("sync");
    const preview = dryRunBoundedReplay(plan(file), currentConfig);
    const executionPlan = plan(file, false);
    let queue: UsageEventInput[] = [{
      source: "claude-code",
      sourceEventId: "old-backlog",
      occurredAt: "2026-10-01T00:00:00.000Z"
    }];
    const merge = (incoming: UsageEventInput[]) => {
      const before = new Set(queue.map((event) => `${event.source}:${event.sourceEventId}`));
      let added = 0;
      for (const event of incoming) {
        const key = `${event.source}:${event.sourceEventId}`;
        if (before.has(key)) continue;
        before.add(key);
        queue.push(event);
        added += 1;
      }
      return { events: queue, added };
    };

    const first = executeBoundedReplay(executionPlan, currentConfig, preview.planDigest, {
      readCurrentConfig: () => currentConfig,
      mergeEvents: merge
    });
    const second = executeBoundedReplay(executionPlan, currentConfig, preview.planDigest, {
      readCurrentConfig: () => currentConfig,
      mergeEvents: merge
    });

    expect(first).toMatchObject({ admitted: 1, duplicates: 0, backlog: 2 });
    expect(second).toMatchObject({ admitted: 0, duplicates: 1, backlog: 2 });
    expect(first.upload).toContain("next Agent/run/sync cycle");
    expect(queue[0].sourceEventId).toBe("old-backlog");
    expect(readFileSync(cursor, "utf8")).toBe("cursor sentinel\n");
  }, 30_000);
});
