import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

function installStalledGit(bin: string): Record<string, string> {
  if (process.platform !== "win32") {
    writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf 'entered\\n' >> \"$B03_GIT_MARKER\"\ntrap '' TERM\nsleep 30\nexit 1\n", { mode: 0o700 });
    return {};
  }
  const preload = join(bin, "git-stall-preload.cjs");
  copyFileSync(process.execPath, join(bin, "git.exe"));
  writeFileSync(preload, [
    "const { appendFileSync } = require('node:fs');",
    "const { basename } = require('node:path');",
    "if (basename(process.execPath).toLowerCase() === 'git.exe') {",
    "  appendFileSync(process.env.B03_GIT_MARKER, 'entered\\n');",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);",
    "  process.exit(1);",
    "}"
  ].join("\n"));
  const portablePreload = preload.replace(/\\/g, "/");
  return { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=\"${portablePreload}\"`.trim() };
}

it("interrupts a real stalled Git process within the replay deadline", () => {
  const { dir, file, request } = fixture();
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const marker = join(dir, "git-entered");
  const shimEnv = installStalledGit(bin);
  const started = Date.now();
  const child = spawnSync(process.execPath, [
    "--import", "tsx", join(process.cwd(), "tests/fixtures/b03-replay-git-deadline.ts"), file, dir
  ], {
    encoding: "utf8",
    env: { ...process.env, ...shimEnv, PATH: `${bin}${delimiter}${process.env.PATH}`, B03_GIT_MARKER: marker },
    timeout: 11_000,
    killSignal: "SIGKILL"
  });
  const elapsedMs = Date.now() - started;
  expect(readFileSync(marker, "utf8").match(/entered/g)).toHaveLength(1);
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("REPLAY_REFUSED Replay refused: Git enrichment exceeded 10000ms deadline");
  expect(child.stdout).not.toContain("REPLAY_COMPLETED");
  expect(elapsedMs).toBeLessThan(12_000);
}, 20_000);

it("bounds both startup version detection and replay Git enrichment in the real CLI", () => {
  const { dir, file, config } = fixture();
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  const state = join(home, ".tokenizer");
  mkdirSync(bin);
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "config.json"), `${JSON.stringify(config)}\n`);
  const marker = join(dir, "git-entered-cli");
  const shimEnv = installStalledGit(bin);
  const queue = join(state, "queue.jsonl");
  const queueBytes = `{ "source": "claude-code", "sourceEventId": "retained", "occurredAt": "2026-10-01T00:00:00.000Z" }\r\n`;
  writeFileSync(queue, queueBytes);
  for (const execute of [false, true]) {
    const started = Date.now();
    const child = spawnSync(process.execPath, [
      "--import", "tsx", join(process.cwd(), "src/cli/index.ts"),
      "replay", "--source", "claude-code", "--file", file,
      "--from", "2026-10-07T00:00:00.000Z", "--to", "2026-10-08T00:00:00.000Z",
      "--max-bytes", "100000", "--max-events", "10",
      ...(execute ? ["--execute", "--confirm", "0".repeat(64)] : [])
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...shimEnv,
        HOME: home,
        USERPROFILE: home,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        B03_GIT_MARKER: marker
      },
      timeout: 12_000,
      killSignal: "SIGKILL"
    });

    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}\n${child.stderr}`).toContain("Git enrichment exceeded 10000ms deadline");
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(readFileSync(queue, "utf8")).toBe(queueBytes);
  }
  expect(readFileSync(marker, "utf8").match(/entered/g)).toHaveLength(4);
}, 30_000);

it("does not let startup version detection pin non-replay CLI help", () => {
  const { dir } = fixture();
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const marker = join(dir, "git-entered-help");
  const shimEnv = installStalledGit(bin);
  const started = Date.now();
  const child = spawnSync(process.execPath, [
    "--import", "tsx", join(process.cwd(), "src/cli/index.ts"), "--help"
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...shimEnv,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      B03_GIT_MARKER: marker
    },
    timeout: 4_000,
    killSignal: "SIGKILL"
  });

  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain("Usage:");
  expect(readFileSync(marker, "utf8").match(/entered/g)).toHaveLength(1);
  expect(Date.now() - started).toBeLessThan(4_000);
}, 10_000);

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
