// Crash-safe local file writes for everything under ~/.tokenizer.
//
// Two problems this solves, both of which get sharper on Windows:
//
// 1. Torn writes. Every state file was written with a bare writeFileSync
//    straight over the live file. A process killed mid-write (Task Scheduler
//    ending a task, laptop sleep, Ctrl-C) leaves a truncated JSON file, and
//    the next run throws on JSON.parse.
// 2. Concurrent read-modify-write. The scheduled task and a manual
//    `tokenizer run` overlap by design. On POSIX the loser silently loses its
//    update; on Windows, mandatory file locking turns the same race into a
//    hard EPERM/EBUSY failure.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// Windows hands out transient EPERM/EBUSY when an antivirus scanner or the
// search indexer has the file open for a few milliseconds. Retrying briefly
// turns a spurious crash into a no-op.
const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 10;
const RENAME_BACKOFF_MS = 20;

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 25;

let tempCounter = 0;

function sleepSync(ms: number): void {
  // Atomics.wait is the only way to block synchronously; the rest of the CLI
  // is synchronous and threading async through it would be a much larger change.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransient(error: unknown): boolean {
  return TRANSIENT_CODES.has((error as NodeJS.ErrnoException)?.code ?? "");
}

/**
 * Write `content` to `path` so a concurrent reader sees either the complete
 * previous file or the complete new one, never a partial write.
 *
 * The temp file is deliberately created in the *target's own directory*:
 * rename is only atomic within a filesystem, and on Windows a cross-volume
 * rename fails outright.
 */
export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;
  try {
    const handle = openSync(temp, "w");
    try {
      writeSync(handle, content);
    } finally {
      closeSync(handle);
    }
  } catch (error) {
    // Without this, a failed write (ENOSPC, EIO) leaks its temp file forever:
    // the rename loop's cleanup below is only reached on a rename failure.
    rmSync(temp, { force: true });
    throw error;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temp, path);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS - 1 || !isTransient(error)) {
        rmSync(temp, { force: true });
        throw error;
      }
      sleepSync(RENAME_BACKOFF_MS);
    }
  }
}

function lockPathFor(path: string): string {
  return `${path}.lock`;
}

function isStale(lock: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > staleMs;
  } catch {
    // Vanished between checks — treat as free rather than stale.
    return false;
  }
}

/**
 * Take over an abandoned lock, atomically.
 *
 * Deliberately a rename and not a stat-then-unlink: those are two operations
 * against a *path*, so a racer that decided "stale" a moment ago can end up
 * unlinking a different, freshly created lock — leaving two processes each
 * convinced they hold it. rename() has exactly one winner: the loser gets
 * ENOENT because the source no longer exists.
 */
function stealStaleLock(lock: string, staleMs: number): boolean {
  if (!isStale(lock, staleMs)) return false;
  const claim = `${lock}.steal.${process.pid}.${tempCounter++}`;
  try {
    renameSync(lock, claim);
  } catch {
    return false;
  }
  rmSync(claim, { force: true });
  return true;
}

/**
 * Release only if the lock is still the one we took.
 *
 * If our own `fn` outran `staleMs`, another process may have legitimately
 * stolen the lock while we were working; deleting the path unconditionally
 * would then evict that new, valid holder.
 */
function releaseLock(lock: string, token: string): void {
  try {
    if (readFileSync(lock, "utf8") !== token) return;
  } catch {
    return;
  }
  rmSync(lock, { force: true });
}

/**
 * Run `fn` while holding an exclusive lock keyed to `path`.
 *
 * Not re-entrant: a nested acquire on the same path blocks until it times out.
 * Holders that die without releasing (SIGKILL, Task Scheduler /End, power
 * loss) leave the lock file behind, so a lock older than `staleMs` is stolen
 * rather than waited on — otherwise the agent would wedge permanently.
 */
export function withFileLock<T>(
  path: string,
  fn: () => T,
  options?: { timeoutMs?: number; staleMs?: number }
): T {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options?.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const lock = lockPathFor(path);
  mkdirSync(dirname(path), { recursive: true });

  // Identifies this specific acquisition, so release can tell our own lock
  // from a successor's. The pid alone is not enough — it is reused.
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + timeoutMs;
  let handle: number | null = null;
  for (;;) {
    try {
      // "wx" fails if the file exists — the atomic test-and-set we need.
      handle = openSync(lock, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && !isTransient(error)) throw error;
      if (stealStaleLock(lock, staleMs)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for lock: ${lock}`);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }

  try {
    writeSync(handle, token);
    closeSync(handle);
  } catch (error) {
    // The token is what release matches on, so a lock we could not stamp is
    // unreleasable. Drop it now rather than making every later caller wait
    // out staleMs for a lock nobody holds.
    try {
      closeSync(handle);
    } catch {
      /* already closed */
    }
    rmSync(lock, { force: true });
    throw error;
  }

  try {
    return fn();
  } finally {
    releaseLock(lock, token);
  }
}

/**
 * Read-modify-write `path` under its lock, persisted atomically.
 *
 * `transform` receives null when the file is absent or unreadable, so callers
 * express "merge into whatever is there" without racing on their own read.
 */
export function updateFileAtomic(path: string, transform: (current: string | null) => string): void {
  withFileLock(path, () => {
    let current: string | null = null;
    if (existsSync(path)) {
      try {
        current = readFileSync(path, "utf8");
      } catch {
        current = null;
      }
    }
    writeFileAtomic(path, transform(current));
  });
}
