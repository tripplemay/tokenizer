import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { acquireAgentLock } from "@/cli/agent-lock";

let dir: string;
const processes: ChildProcess[] = [];
const trackedPids = new Set<number>();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tokenizer-agent-lifecycle-"));
});

afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already exited */
    }
  }
  trackedPids.clear();
  rmSync(dir, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for pid ${child.pid} to exit`)), timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe("agent command parsing", () => {
  it("rejects `tokenizer agent status` before it can start a daemon", () => {
    const home = join(dir, "home");
    mkdirSync(join(home, ".tokenizer"), { recursive: true });
    writeFileSync(join(home, ".tokenizer", "config.json"), JSON.stringify({
      serverUrl: "http://127.0.0.1:9",
      projectRoots: [],
      sources: { claude: true, codex: true, opencode: true, aider: true, kimicode: true }
    }));

    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [tsx, "src/cli/index.ts", "agent", "status"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
      timeout: 5_000,
      killSignal: "SIGTERM"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/too many arguments/i);
  });
});

describe("agent single-instance lock", () => {
  it("rejects a second agent while the recorded PID is live", () => {
    const path = join(dir, "agent.lock");
    const first = acquireAgentLock({ path });

    expect(() => acquireAgentLock({ path })).toThrow(new RegExp(`already running \\(pid ${process.pid}\\)`, "i"));

    first.release();
    expect(existsSync(path)).toBe(false);
  });

  it("reclaims a lock left by a dead PID", () => {
    const path = join(dir, "agent.lock");
    writeFileSync(path, `${JSON.stringify({ pid: 2_147_483_647, token: "crashed", startedAt: "2026-08-02T00:00:00.000Z" })}\n`);

    const recovered = acquireAgentLock({ path });
    const record = JSON.parse(readFileSync(path, "utf8"));
    expect(record.pid).toBe(process.pid);
    expect(record.token).toEqual(expect.any(String));

    recovered.release();
    expect(existsSync(path)).toBe(false);
  });

  it("does not remove a successor lock during release", () => {
    const path = join(dir, "agent.lock");
    const first = acquireAgentLock({ path });
    const successor = `${JSON.stringify({ pid: 2_147_483_647, token: "successor", startedAt: "2026-08-02T00:00:00.000Z" })}\n`;
    writeFileSync(path, successor);

    first.release();
    expect(readFileSync(path, "utf8")).toBe(successor);
  });

  it.skipIf(process.platform === "win32")("releases the lock when the running agent receives SIGTERM", async () => {
    const home = join(dir, "agent-home");
    const tokenizerDir = join(home, ".tokenizer");
    mkdirSync(tokenizerDir, { recursive: true });
    writeFileSync(join(tokenizerDir, "config.json"), JSON.stringify({
      serverUrl: "http://127.0.0.1:9",
      projectRoots: [],
      sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false }
    }));

    // Run the lock owner directly, not the tsx launcher whose close event can
    // precede its child's signal-handler cleanup.
    const agent = spawn(process.execPath, ["--import", "tsx", "src/cli/index.ts", "agent", "--heartbeat-seconds", "3600", "--sync-minutes", "3600"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: "ignore"
    });
    processes.push(agent);

    const lockPath = join(tokenizerDir, "agent.lock");
    const statePath = join(tokenizerDir, "state.json");
    // The lock file appears a few instructions before the SIGTERM handler is
    // installed; the "running" state write happens after it. Waiting for the
    // latter keeps a heavily loaded scheduler from delivering SIGTERM into
    // the default-disposition window, where a stale lock is expected.
    await waitFor(() => {
      if (!existsSync(lockPath) || !existsSync(statePath)) return false;
      try {
        return JSON.parse(readFileSync(statePath, "utf8"))?.agent?.status === "running";
      } catch {
        return false;
      }
    }, "agent did not reach running state", 10_000);
    expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(agent.pid);
    expect(JSON.parse(readFileSync(statePath, "utf8")).agent.pid).toBe(agent.pid);
    expect(agent.kill("SIGTERM")).toBe(true);
    expect(await waitForExit(agent)).toEqual({ code: 0, signal: null });
    expect(existsSync(lockPath)).toBe(false);
    expect(JSON.parse(readFileSync(statePath, "utf8")).agent).toMatchObject({
      status: "stopped",
      pid: agent.pid,
      stoppedAt: expect.any(String)
    });
  }, 15_000);

  it.skipIf(process.platform !== "win32")("reclaims a lock after Windows force-terminates the agent", async () => {
    const home = join(dir, "agent-home");
    const tokenizerDir = join(home, ".tokenizer");
    mkdirSync(tokenizerDir, { recursive: true });
    writeFileSync(join(tokenizerDir, "config.json"), JSON.stringify({
      serverUrl: "http://127.0.0.1:9",
      projectRoots: [],
      sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false }
    }));

    const agent = spawn(process.execPath, ["--import", "tsx", "src/cli/index.ts", "agent", "--heartbeat-seconds", "3600", "--sync-minutes", "3600"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: "ignore"
    });
    processes.push(agent);

    const lockPath = join(tokenizerDir, "agent.lock");
    const statePath = join(tokenizerDir, "state.json");
    await waitFor(() => {
      if (!existsSync(lockPath) || !existsSync(statePath)) return false;
      try {
        return JSON.parse(readFileSync(statePath, "utf8"))?.agent?.status === "running";
      } catch {
        return false;
      }
    }, "agent did not reach running state", 10_000);
    const originalLock = readFileSync(lockPath, "utf8");
    const owner = JSON.parse(originalLock);
    const runningState = JSON.parse(readFileSync(statePath, "utf8")).agent;
    expect(owner.pid).toBe(agent.pid);
    expect(runningState.pid).toBe(agent.pid);
    expect(isAlive(owner.pid)).toBe(true);
    expect(() => acquireAgentLock({ path: lockPath })).toThrow(`already running (pid ${owner.pid})`);
    expect(readFileSync(lockPath, "utf8")).toBe(originalLock);

    // Windows force-terminates this direct owner; no graceful signal handler
    // runs. SIGKILL also makes the intended stale-lock fixture explicit.
    expect(agent.kill("SIGKILL")).toBe(true);
    await waitForExit(agent, 10_000);
    expect(isAlive(owner.pid)).toBe(false);
    expect(readFileSync(lockPath, "utf8")).toBe(originalLock);
    expect(JSON.parse(readFileSync(statePath, "utf8")).agent).toEqual(runningState);
    const recovered = acquireAgentLock({ path: lockPath });
    const successor = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(successor.pid).toBe(process.pid);
    expect(successor.token).not.toBe(owner.token);
    recovered.release();
    expect(existsSync(lockPath)).toBe(false);
  }, 20_000);
});

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("tokenizer wrapper lifecycle", () => {
  it("handles SIGTERM delivered before spawn returns without orphaning its child", async () => {
    const bin = join(dir, "bin");
    const fakeNode = join(bin, "node");
    const childPidPath = join(dir, "early-child.pid");
    const preloadPath = join(dir, "early-signal.mjs");
    mkdirSync(bin, { recursive: true });
    writeFileSync(fakeNode, `#!/bin/sh
trap 'exit 0' INT TERM HUP
printf '%s' "$$" > "$TOKENIZER_TEST_CHILD_PID_FILE"
while :; do sleep 1; done
`);
    chmodSync(fakeNode, 0o755);
    // Hold the wrapper inside spawn until the child is ready and a helper
    // has sent SIGTERM. This deterministically tests handler ordering.
    writeFileSync(preloadPath, `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  const trigger = childProcess.spawnSync(process.execPath, ["-e", ${JSON.stringify(`
    const fs = require("node:fs");
    const deadline = Date.now() + 5000;
    function signalWhenReady() {
      const path = process.env.TOKENIZER_TEST_CHILD_PID_FILE;
      if (fs.existsSync(path) && /^\\d+$/.test(fs.readFileSync(path, "utf8"))) {
        process.kill(Number(process.argv[1]), "SIGTERM");
      } else if (Date.now() >= deadline) {
        process.exitCode = 1;
      } else {
        setTimeout(signalWhenReady, 10);
      }
    }
    signalWhenReady();
  `)}, String(process.pid)], { timeout: 6000 });
  if (trigger.status !== 0) throw new Error("early SIGTERM trigger failed");
  return child;
};
syncBuiltinESMExports();
`);

    const wrapper = spawn(process.execPath, ["--import", preloadPath, join(process.cwd(), "bin", "tokenizer")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        TOKENIZER_TEST_CHILD_PID_FILE: childPidPath
      },
      stdio: "ignore"
    });
    processes.push(wrapper);
    await waitFor(() => existsSync(childPidPath) && /^\d+$/.test(readFileSync(childPidPath, "utf8")), "early-signal child did not start");
    const childPid = Number(readFileSync(childPidPath, "utf8"));
    trackedPids.add(childPid);
    expect(await waitForExit(wrapper)).toEqual({ code: 0, signal: null });
    await waitFor(() => !isAlive(childPid), "early SIGTERM orphaned the wrapper child");
  }, 15_000);

  it("forwards SIGTERM to its async child and waits for that child to exit", async () => {
    const bin = join(dir, "bin");
    const fakeNode = join(bin, "node");
    const childPidPath = join(dir, "child.pid");
    mkdirSync(bin, { recursive: true });
    writeFileSync(fakeNode, `#!/bin/sh
printf '%s' "$$" > "$TOKENIZER_TEST_CHILD_PID_FILE"
trap 'exit 0' INT TERM HUP
while :; do sleep 1; done
`);
    chmodSync(fakeNode, 0o755);

    const wrapper = spawn(process.execPath, [join(process.cwd(), "bin", "tokenizer")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        TOKENIZER_TEST_CHILD_PID_FILE: childPidPath
      },
      stdio: "ignore"
    });
    processes.push(wrapper);

    await waitFor(() => existsSync(childPidPath) && /^\d+$/.test(readFileSync(childPidPath, "utf8")), "wrapper did not start its child");
    const childPid = Number(readFileSync(childPidPath, "utf8"));
    trackedPids.add(childPid);
    expect(isAlive(childPid)).toBe(true);

    wrapper.kill("SIGTERM");
    const result = await waitForExit(wrapper);
    expect(result.signal).toBeNull();
    await waitFor(() => !isAlive(childPid), "wrapper exited but left its child running");
  });
});
