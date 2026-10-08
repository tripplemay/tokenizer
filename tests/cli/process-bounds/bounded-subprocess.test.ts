import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoundedSubprocessLaunchError, BoundedSubprocessOutputError, BoundedSubprocessTimeoutError, BoundedSubprocessSupervisionError,
  runBoundedSubprocess, SUBPROCESS_TOTAL_ALLOWANCE_MS
} from "../../../src/cli/bounded-subprocess";

const fixture = fileURLToPath(new URL("../../fixtures/process-bounds/child.mjs", import.meta.url));
let root: string;
let pidFile: string;
let env: NodeJS.ProcessEnv;

function pids(): number[] {
  try { return readFileSync(pidFile, "utf8").trim().split("\n").map(Number); } catch { return []; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pb-")));
  mkdirSync(join(root, "home"));
  mkdirSync(join(root, "tmp"));
  pidFile = join(root, "pids");
  env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), TMPDIR: join(root, "tmp") };
});

afterEach(() => {
  for (const pid of pids()) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* only fixture-owned groups */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* fixture already reaped */ }
  }
  rmSync(root, { recursive: true, force: true });
});

function run(mode: string, timeoutMs = 500, maxOutputBytes = 1_024) {
  return runBoundedSubprocess(process.execPath, [fixture, mode, pidFile, "one;two", "three four"], {
    cwd: root, env, timeoutMs, maxOutputBytes
  });
}

describe("bounded subprocess primitive", () => {
  it("preserves explicit argv, cwd/env, stdout/stderr and success", () => {
    const result = run("normal", 2_000);
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("stderr-control");
    expect(JSON.parse(result.stdout)).toEqual({ argv: ["one;two", "three four"], cwd: root, home: env.HOME });
  });

  it("preserves ordinary nonzero exit without confusing it with launch failure", () => {
    expect(run("nonzero", 2_000)).toMatchObject({ status: 23, signal: null, stdout: "ordinary-failure" });
    expect(() => runBoundedSubprocess(join(root, "missing"), [], {
      cwd: root, env, timeoutMs: 500, maxOutputBytes: 1_024
    })).toThrow(BoundedSubprocessLaunchError);
  });

  it("distinguishes a missing target cwd from worker supervision failure", () => {
    let caught: unknown;
    try {
      runBoundedSubprocess(process.execPath, [fixture, "normal", pidFile], {
        cwd: join(root, "missing"), env, timeoutMs: 500, maxOutputBytes: 1_024
      });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(BoundedSubprocessLaunchError);
    expect(caught).toHaveProperty("code", "ENOENT");
    const preload = fileURLToPath(new URL("../../fixtures/process-bounds/worker-failure.mjs", import.meta.url));
    try {
      runBoundedSubprocess(process.execPath, [fixture, "normal", pidFile], {
        cwd: root, env: { ...env, NODE_OPTIONS: `--import=${preload}` }, timeoutMs: 500, maxOutputBytes: 1_024
      });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(BoundedSubprocessSupervisionError);
    expect(String(caught)).not.toContain("RAW-WORKER");
    expect(pids()).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("preserves termination signal", () => {
    expect(run("signal", 2_000)).toMatchObject({ status: null, signal: "SIGTERM" });
  });

  it.each([0, -1, NaN, Infinity, 0.5, 2 ** 32])("rejects invalid timeout %s before launch", (timeoutMs) => {
    expect(() => run("normal", timeoutMs)).toThrow(RangeError);
    expect(pids()).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity, 0.5, 2 ** 32])("rejects invalid output budget %s before launch", (maxOutputBytes) => {
    expect(() => run("normal", 500, maxOutputBytes)).toThrow(RangeError);
    expect(pids()).toEqual([]);
  });

  it.each(["resistant", "descendant", "inherited-pipes"])("bounds %s and reaps owned native processes", async (mode) => {
    const start = Date.now();
    expect(() => run(mode)).toThrow(BoundedSubprocessTimeoutError);
    expect(Date.now() - start).toBeLessThan(500 + SUBPROCESS_TOTAL_ALLOWANCE_MS);
    expect(pids().length).toBe(mode === "resistant" ? 1 : 2);
    await expect.poll(() => pids().some(alive), { timeout: 2_000 }).toBe(false);
  });

  it("caps combined streams, omits raw stderr from errors and cleans overflow child", async () => {
    let caught: unknown;
    try { run("overflow", 2_000, 2_048); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(BoundedSubprocessOutputError);
    expect(String(caught)).not.toContain("RAW-STDERR-CANARY");
    await expect.poll(() => pids().some(alive), { timeout: 2_000 }).toBe(false);
  });

  it.skipIf(process.platform !== "win32")("uses a real Windows executable for tree cleanup", async () => {
    expect(() => run("descendant")).toThrow(BoundedSubprocessTimeoutError);
    await expect.poll(() => pids().some(alive), { timeout: 2_000 }).toBe(false);
  });
});
