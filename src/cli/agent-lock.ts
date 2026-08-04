import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { withFileLock } from "./atomic-file";

type LockRecord = {
  pid: number;
  token: string;
  startedAt: string;
};

export type AgentLock = {
  path: string;
  pid: number;
  release: () => void;
};

export const agentLockPath = join(homedir(), ".tokenizer", "agent.lock");

function readLock(path: string): { raw: string; record: LockRecord | null } {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed.token !== "string") {
      return { raw, record: null };
    }
    return { raw, record: { pid: parsed.pid, token: parsed.token, startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "" } };
  } catch {
    return { raw: "", record: null };
  }
}

function isLiveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM still proves that a process owns the PID. Treat it as live rather
    // than risking two agents under different privilege boundaries.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function coordinationPath(path: string): string {
  // The long-lived lock cannot be safely inspected and replaced with separate
  // path operations. A short-lived companion lock serializes every acquire
  // and release, including stale-lock recovery.
  return `${path}.coordination`;
}

/**
 * Acquire the one foreground/background Agent slot for this OS user.
 *
 * A crashed process leaves its PID record behind. The next invocation only
 * reclaims it after proving that PID is gone, so a healthy launchd instance
 * cannot be displaced by a second manual `tokenizer agent` command.
 */
export function acquireAgentLock(options: { path?: string; pid?: number } = {}): AgentLock {
  const path = options.path ?? agentLockPath;
  const pid = options.pid ?? process.pid;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid agent PID: ${pid}`);

  const record: LockRecord = {
    pid,
    token: randomUUID(),
    startedAt: new Date().toISOString()
  };
  const serialized = `${JSON.stringify(record)}\n`;
  mkdirSync(dirname(path), { recursive: true });

  withFileLock(coordinationPath(path), () => {
    if (existsSync(path)) {
      const owner = readLock(path).record;
      if (owner && isLiveProcess(owner.pid)) {
        throw new Error(`Tokenizer agent is already running (pid ${owner.pid}). Stop it before starting another agent.`);
      }
      // The file is either corrupt or belongs to a no-longer-live PID. We hold
      // the coordination lock, so no concurrent acquire can race this cleanup.
      rmSync(path, { force: true });
    }

    let handle: number | null = null;
    let created = false;
    try {
      handle = openSync(path, "wx", 0o600);
      created = true;
      writeSync(handle, serialized);
    } catch (error) {
      if (handle !== null) {
        closeSync(handle);
        handle = null;
      }
      // Only remove a file this invocation actually created. An unexpected
      // external writer must never be mistaken for our failed acquisition.
      if (created) rmSync(path, { force: true });
      throw error;
    } finally {
      if (handle !== null) closeSync(handle);
    }
  });

  let released = false;
  return {
    path,
    pid,
    release: () => {
      if (released) return;
      released = true;
      try {
        withFileLock(coordinationPath(path), () => {
          const current = readLock(path);
          // Never remove a lock inherited by a later PID or acquisition.
          if (current.raw === serialized) rmSync(path, { force: true });
        });
      } catch {
        // A failed release is recoverable: its PID will be dead on the next
        // startup and stale-lock recovery above will reclaim the record.
      }
    }
  };
}
