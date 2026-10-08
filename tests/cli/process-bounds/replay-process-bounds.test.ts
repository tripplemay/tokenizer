import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGitShim } from "./fixtures";
import { runBoundedSubprocess } from "../../../src/cli/bounded-subprocess";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const probe = fileURLToPath(new URL("../../fixtures/process-bounds/replay-probe.mjs", import.meta.url));
const descendant = fileURLToPath(new URL("../../fixtures/process-bounds/child.mjs", import.meta.url));
let root: string;
let env: NodeJS.ProcessEnv;
let request: Record<string, unknown>;
let config: Record<string, unknown>;
let queue: string;
let protectedPaths: string[];

function pids(): number[] {
  try { return readFileSync(join(root, "pids"), "utf8").trim().split("\n").map(Number); } catch { return []; }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pbr-")));
  const home = join(root, "home");
  mkdirSync(join(home, ".tokenizer"), { recursive: true });
  mkdirSync(join(root, "tmp"));
  env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: join(root, "tmp"), PB_PRODUCT_ROOT: repo,
    PB_REPLAY_MANIFEST: join(root, "manifest.json"), PB_PID_FILE: join(root, "pids") };
  env.PB_REAL_GIT = execFileSync(process.platform === "win32" ? "where.exe" : "/usr/bin/which", ["git"], { env, encoding: "utf8", timeout: 2_000 }).trim().split(/\r?\n/)[0];
  const file = join(root, "source.jsonl");
  writeFileSync(file, JSON.stringify({ type: "assistant", uuid: "replay-bound", cwd: root, timestamp: "2026-10-07T12:00:00.000Z",
    message: { role: "assistant", id: "replay-bound", content: "RAW-MESSAGE-CANARY", usage: { input_tokens: 3 } } }) + "\n");
  request = { source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10 };
  config = { serverUrl: "http://127.0.0.1:9", projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths: [root], excludePaths: [] } };
  queue = join(home, ".tokenizer", "queue.jsonl");
  protectedPaths = [queue, join(home, ".tokenizer", "cursor.json"), join(home, ".tokenizer", "config.json")];
  writeFileSync(queue, JSON.stringify({ source: "claude-code", sourceEventId: "retained", occurredAt: "2026-10-07T12:00:00.000Z" }) + "\n");
  writeFileSync(protectedPaths[1], '{"cursor":"unchanged"}\n');
  writeFileSync(protectedPaths[2], JSON.stringify(config));
});

afterEach(() => {
  for (const pid of pids()) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* owned group only */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  }
  rmSync(root, { recursive: true, force: true });
});

function run(mode: string, extra: Partial<NodeJS.ProcessEnv> = {}, confirmation?: string) {
  writeFileSync(env.PB_REPLAY_MANIFEST!, JSON.stringify({ request, config, queue, mode, confirmation }));
  const result = runBoundedSubprocess(process.execPath, ["--import", "tsx", probe], {
    cwd: repo, env: { ...env, ...extra }, timeoutMs: 13_000, maxOutputBytes: 4_096
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

it.each(["preview", "execute"])("refuses %s with a real resistant Git tree and preserves all state", async (mode) => {
  const before = protectedPaths.map((path) => readFileSync(path));
  const confirmation = mode === "execute" ? run("preview").result.planDigest : undefined;
  const result = run(mode, { ...makeGitShim(root, env), PB_GIT_MODE: "stall", PB_DESCENDANT_FIXTURE: descendant }, confirmation);
  expect(result.error).toMatch(/Replay refused: Git enrichment exceeded 10000ms deadline/);
  expect(result.elapsedMs).toBeLessThan(10_000);
  expect(protectedPaths.map((path) => readFileSync(path))).toEqual(before);
  expect(pids().length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => pids().some((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }), { timeout: 2_000 }).toBe(false);
  console.log("REPLAY_BOUND", JSON.stringify({ mode, elapsedMs: result.elapsedMs, trackedProcesses: pids().length, stateUnchanged: true, liveOwnedProcesses: 0 }));
}, 20_000);

it.each(["preview", "execute"])("refuses %s output overflow without leaking raw stderr", (mode) => {
  const before = protectedPaths.map((path) => readFileSync(path));
  const confirmation = mode === "execute" ? run("preview").result.planDigest : undefined;
  const result = run(mode, { ...makeGitShim(root, env), PB_GIT_MODE: "overflow" }, confirmation);
  expect(result.error).toBe("Replay refused: Git enrichment could not complete safely");
  expect(JSON.stringify(result)).not.toMatch(/RAW-GIT|RAW-MESSAGE/);
  expect(protectedPaths.map((path) => readFileSync(path))).toEqual(before);
});

it("does not renew the deadline across successive real Git calls", () => {
  for (const args of [["init", "-q"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "initial"]]) {
    execFileSync(env.PB_REAL_GIT!, args, { cwd: root, env, timeout: 2_000, stdio: "pipe" });
  }
  const result = run("preview", { ...makeGitShim(root, env), PB_GIT_DELAY_MS: "2500" });
  expect(result.error).toMatch(/deadline/);
  expect(result.elapsedMs).toBeLessThan(10_000);
  expect(pids().length).toBeGreaterThan(1);
  console.log("SHARED_GIT_DEADLINE", JSON.stringify({ elapsedMs: result.elapsedMs, gitInvocations: pids().length }));
}, 20_000);

it("retains the production before-mutate deadline guard under the queue lock", () => {
  const before = protectedPaths.map((path) => readFileSync(path));
  const preview = run("preview");
  const result = run("late-lock", {}, preview.result.planDigest);
  expect(result.lockSeen).toBe(true);
  expect(result.error).toBe("Replay refused: queue admission exceeded 10000ms deadline");
  expect(existsSync(`${queue}.lock`)).toBe(false);
  expect(protectedPaths.map((path) => readFileSync(path))).toEqual(before);
  console.log("QUEUE_LOCK_GUARD", JSON.stringify({ lockSeen: result.lockSeen, error: result.error, stateUnchanged: true }));
});

it("preserves ordinary Git enrichment and read-only preview, then admits a confirmed minimal event", () => {
  for (const args of [["init", "-q"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "initial"],
    ["remote", "add", "origin", "https://reader:PRIVATE@git.example/team/fixture.git"]]) {
    execFileSync(env.PB_REAL_GIT!, args, { cwd: root, env, timeout: 2_000, stdio: "pipe" });
  }
  const before = protectedPaths.map((path) => readFileSync(path));
  const preview = run("preview");
  expect(preview.result.wouldAdmit).toBe(1);
  expect(protectedPaths.map((path) => readFileSync(path))).toEqual(before);
  expect(run("execute", {}, preview.result.planDigest).result.admitted).toBe(1);
  const content = readFileSync(queue, "utf8");
  expect(content).not.toMatch(/RAW-MESSAGE|PRIVATE|reader/);
  const admitted = content.trim().split("\n").map((line) => JSON.parse(line)).find((event) => event.sourceEventId !== "retained");
  expect(admitted.gitCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(admitted.gitRemote).toBe("https://git.example/team/fixture.git");
  expect(protectedPaths.slice(1).map((path) => readFileSync(path))).toEqual(before.slice(1));
});
