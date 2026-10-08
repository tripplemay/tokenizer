import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGitShim } from "./fixtures";
import { runBoundedSubprocess } from "../../../src/cli/bounded-subprocess";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const probe = fileURLToPath(new URL("../../fixtures/process-bounds/agent-version-probe.mjs", import.meta.url));
let root: string;
let env: NodeJS.ProcessEnv;
let realGit: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pbv-")));
  mkdirSync(join(root, "home"));
  mkdirSync(join(root, "tmp"));
  env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), TMPDIR: join(root, "tmp"),
    PB_VERSION_MODULE: join(repo, "src/cli/agent-version.ts"), PB_PID_FILE: join(root, "pids") };
  realGit = execFileSync(process.platform === "win32" ? "where.exe" : "/usr/bin/which", ["git"], { env, encoding: "utf8", timeout: 2_000 }).trim().split(/\r?\n/)[0];
  env.PB_REAL_GIT = realGit;
});

afterEach(() => {
  let pids: number[] = [];
  try { pids = readFileSync(join(root, "pids"), "utf8").trim().split("\n").map(Number); } catch { /* no shim */ }
  for (const pid of pids) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* owned group only */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ }
  }
  rmSync(root, { recursive: true, force: true });
});

function readVersion(probeEnv = env) {
  const result = runBoundedSubprocess(process.execPath, ["--import", "tsx", probe], {
    cwd: repo, env: probeEnv, timeoutMs: 7_000, maxOutputBytes: 4_096
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

it("captures the actual install checkout SHA", () => {
  const expected = execFileSync(realGit, ["rev-parse", "--short=12", "HEAD"], { cwd: repo, env, encoding: "utf8", timeout: 2_000 }).trim();
  expect(readVersion()).toMatchObject({ first: expected, second: expected });
});

it.each(["stall", "overflow", "invalid", "short", "nonzero", "signal"])("bounds real startup executable mode %s and returns null", (mode) => {
  const result = readVersion({ ...makeGitShim(root, env), PB_GIT_MODE: mode });
  expect(result).toMatchObject({ first: null, second: null });
  expect(result.elapsedMs).toBeLessThan(process.platform === "win32" ? 5_000 : 4_000);
  console.log("STARTUP_BOUND", JSON.stringify({ mode, elapsedMs: result.elapsedMs, version: result.first }));
}, 10_000);

it("keeps its import-time SHA even after the install checkout advances", () => {
  const snapshot = join(root, "snapshot");
  const module = join(snapshot, "src/cli/agent-version.ts");
  mkdirSync(dirname(module), { recursive: true });
  for (const name of ["agent-version.ts", "bounded-subprocess.ts", "bounded-subprocess-worker.mjs"]) {
    copyFileSync(join(repo, "src/cli", name), join(snapshot, "src/cli", name));
  }
  for (const args of [["init", "-q"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "first"]]) {
    execFileSync(realGit, args, { cwd: snapshot, env, timeout: 2_000, stdio: "pipe" });
  }
  const result = readVersion({ ...env, PB_VERSION_MODULE: module, PB_SNAPSHOT_ROOT: snapshot });
  expect(result.first).toMatch(/^[0-9a-f]{12}$/);
  expect(result.second).toBe(result.first);
  expect(result.disk).not.toBe(result.first);
});

it.skipIf(process.platform !== "win32")("uses native git.exe rather than .cmd resolution on Windows", () => {
  expect(readVersion({ ...makeGitShim(root, env), PB_GIT_MODE: "valid" }).first).toBe("a".repeat(12));
});
