import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as git from "@/cli/git";
import { mergeQueue } from "@/cli/collect";
import { dryRunBoundedReplay, executeBoundedReplay } from "@/cli/replay";
import { planBoundedReplay } from "@/cli/replay-contract";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "b03-replay-deadline-"));
  roots.push(dir);
  const file = join(dir, "source.jsonl");
  writeFileSync(file, `${JSON.stringify({
    type: "assistant", uuid: "one", cwd: dir, timestamp: "2026-10-07T12:00:00.000Z",
    message: { role: "assistant", id: "one", usage: { input_tokens: 1 } }
  })}\n`);
  const request = {
    source: "claude-code", file,
    from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z",
    maxBytes: 100_000, maxEvents: 10
  };
  const config = {
    serverUrl: "http://127.0.0.1:9", projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only" as const, includePaths: [dir], excludePaths: [] }
  };
  return { dir, file, request, config };
}

it.skipIf(process.platform === "win32")("interrupts a real stalled Git process within the replay deadline", () => {
  const { dir, file, request } = fixture();
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const marker = join(dir, "git-entered");
  writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf 'entered\\n' >> \"$B03_GIT_MARKER\"\nsleep 12\nexit 1\n", { mode: 0o700 });
  const started = Date.now();
  const child = spawnSync(process.execPath, [
    "--import", "tsx", join(process.cwd(), "tests/fixtures/b03-replay-git-deadline.ts"), file, dir
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, B03_GIT_MARKER: marker },
    timeout: 11_000,
    killSignal: "SIGKILL"
  });
  const elapsedMs = Date.now() - started;
  expect(readFileSync(marker, "utf8")).toContain("entered");
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("REPLAY_REFUSED Replay refused: Git enrichment exceeded 10000ms deadline");
  expect(child.stdout).not.toContain("REPLAY_COMPLETED");
  expect(elapsedMs).toBeLessThan(10_000);
}, 20_000);

it("uses one execution deadline across both enrichments and refuses before merge", () => {
  const { request, config } = fixture();
  let phase: "preview" | "execute" = "preview";
  let calls = 0;
  let clock = 0;
  vi.spyOn(git, "enrichEventsWithGit").mockImplementation((events) => {
    if (phase === "preview") return events;
    calls += 1;
    clock += calls === 1 ? 6_000 : 5_000;
    return events;
  });
  const preview = dryRunBoundedReplay(planBoundedReplay(request), config);
  phase = "execute";
  clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const merge = vi.fn((events) => ({ events, added: events.length }));
  expect(() => executeBoundedReplay(
    planBoundedReplay({ ...request, dryRun: false }), config, preview.planDigest,
    { readCurrentConfig: () => config, mergeEvents: merge }
  )).toThrow(/exceeded 10000ms deadline/);
  expect(calls).toBe(2);
  expect(merge).not.toHaveBeenCalled();
});

it("keeps normal collection enrichment opt-in free and preserves event identity", () => {
  const input = [{
    source: "claude-code" as const,
    sourceEventId: "normal-collect",
    occurredAt: "2026-10-07T12:00:00.000Z"
  }];
  expect(git.enrichEventsWithGit(input)).toEqual([{
    ...input[0], workspacePath: undefined, localWorkspacePath: null
  }]);
});

it("leaves the durable queue byte-identical when the final deadline trips under its lock", () => {
  const { dir } = fixture();
  const queue = join(dir, "queue.jsonl");
  const retained = {
    source: "claude-code" as const,
    sourceEventId: "retained",
    occurredAt: "2026-10-07T12:00:00.000Z"
  };
  writeFileSync(queue, `${JSON.stringify(retained)}\n`);
  const before = readFileSync(queue, "utf8");
  expect(() => mergeQueue([{
    ...retained, sourceEventId: "must-not-land"
  }], queue, {
    timeoutMs: 100,
    beforeMutate: () => { throw new Error("Replay refused: queue admission exceeded 10000ms deadline"); }
  })).toThrow("queue admission exceeded");
  expect(readFileSync(queue, "utf8")).toBe(before);
});
