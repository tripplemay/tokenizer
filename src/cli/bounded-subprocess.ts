import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

export class BoundedSubprocessTimeoutError extends Error {}
export class BoundedSubprocessOutputError extends Error {}
export class BoundedSubprocessLaunchError extends Error {}
export class BoundedSubprocessSupervisionError extends Error {}

// The worker gets 1 s for tree termination and close notification, plus 1 s
// for startup/response delivery. These are scheduling allowances, not a hard
// real-time guarantee under OS suspension, stalled syscalls or escaped groups.
export const SUBPROCESS_CLEANUP_ALLOWANCE_MS = 1_000;
export const SUBPROCESS_WATCHDOG_ALLOWANCE_MS = 1_000;
export const SUBPROCESS_TOTAL_ALLOWANCE_MS = SUBPROCESS_CLEANUP_ALLOWANCE_MS + SUBPROCESS_WATCHDOG_ALLOWANCE_MS +
  (process.platform === "win32" ? SUBPROCESS_CLEANUP_ALLOWANCE_MS : 0);

export type BoundedSubprocessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type WorkerResult = {
  kind: "ok" | "timeout" | "output" | "launch" | "supervision";
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
};

const worker = fileURLToPath(new URL("./bounded-subprocess-worker.mjs", import.meta.url));

// Only used if the worker watchdog/protocol fails, after it has published its
// owned child PID. Never discover targets by executable name or process scan.
function cleanupAfterWorkerFailure(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore", windowsHide: true, timeout: SUBPROCESS_CLEANUP_ALLOWANCE_MS, killSignal: "SIGKILL"
    });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* owned group already exited */ }
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* owned child already exited */ }
}

export function runBoundedSubprocess(
  command: string,
  args: string[],
  options: Pick<SpawnSyncOptions, "cwd" | "env" | "windowsHide"> & {
    timeoutMs: number;
    maxOutputBytes: number;
  }
): BoundedSubprocessResult {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 ||
      options.timeoutMs > 2_147_483_647 - SUBPROCESS_TOTAL_ALLOWANCE_MS) {
    throw new RangeError("subprocess timeout must be a positive bounded integer");
  }
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0 ||
      options.maxOutputBytes > 16 * 1024 * 1024) {
    throw new RangeError("subprocess output limit must be between 1 byte and 16 MiB");
  }
  if (typeof command !== "string" || !command || command.includes("\0") ||
      !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("subprocess requires an executable and an explicit string argument array");
  }
  const helper = spawnSync(process.execPath, [worker, JSON.stringify({
    command, args, timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes,
    cleanupMs: SUBPROCESS_CLEANUP_ALLOWANCE_MS
  })], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs + SUBPROCESS_CLEANUP_ALLOWANCE_MS + SUBPROCESS_WATCHDOG_ALLOWANCE_MS,
    killSignal: "SIGKILL",
    maxBuffer: Math.ceil(options.maxOutputBytes * 4 / 3) + 4_096,
    windowsHide: options.windowsHide ?? true
  });
  const lines = (helper.stdout ?? "").split("\n");
  const pid = /^\d+$/.test(lines[0]) ? Number(lines[0]) : 0;
  const ownedPid = Number.isSafeInteger(pid) && pid > 0;
  let result: WorkerResult;
  try {
    if (helper.error || helper.status !== 0 || !/^\d+$/.test(lines[0]) || lines.length !== 2) throw new Error();
    result = JSON.parse(lines[1]) as WorkerResult;
    if (!["ok", "timeout", "output", "launch", "supervision"].includes(result.kind)) throw new Error();
    if (result.kind === "ok" && (!ownedPid || typeof result.stdout !== "string" || typeof result.stderr !== "string" ||
        !(result.status === null || Number.isInteger(result.status)) ||
        !(result.signal === null || typeof result.signal === "string"))) throw new Error();
  } catch {
    if (ownedPid) cleanupAfterWorkerFailure(pid);
    if ((helper.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
      throw new BoundedSubprocessTimeoutError("subprocess worker deadline exceeded");
    }
    throw new BoundedSubprocessSupervisionError("subprocess supervision failed");
  }
  if (result.kind === "timeout") throw new BoundedSubprocessTimeoutError("subprocess deadline exceeded");
  if (result.kind === "output") throw new BoundedSubprocessOutputError("subprocess output limit exceeded");
  if (result.kind === "launch") throw new BoundedSubprocessLaunchError("subprocess failed to start");
  if (result.kind === "supervision") throw new BoundedSubprocessSupervisionError("subprocess cleanup failed");
  const stdout = Buffer.from(result.stdout!, "base64");
  const stderr = Buffer.from(result.stderr!, "base64");
  if (stdout.length + stderr.length > options.maxOutputBytes) {
    cleanupAfterWorkerFailure(pid);
    throw new BoundedSubprocessOutputError("subprocess response limit exceeded");
  }
  return { status: result.status!, signal: result.signal!, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
}
