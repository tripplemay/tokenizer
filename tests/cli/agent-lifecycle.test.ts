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
      env: { ...process.env, HOME: home },
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

  it("releases the lock when the running agent receives SIGTERM", async () => {
    const home = join(dir, "agent-home");
    const tokenizerDir = join(home, ".tokenizer");
    mkdirSync(tokenizerDir, { recursive: true });
    writeFileSync(join(tokenizerDir, "config.json"), JSON.stringify({
      serverUrl: "http://127.0.0.1:9",
      projectRoots: [],
      sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false }
    }));

    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const agent = spawn(process.execPath, [tsx, "src/cli/index.ts", "agent", "--heartbeat-seconds", "3600", "--sync-minutes", "3600"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
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
    agent.kill("SIGTERM");
    await waitForExit(agent);
    expect(existsSync(lockPath)).toBe(false);
  });
});

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("tokenizer wrapper lifecycle", () => {
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
