import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

export class BoundedSubprocessTimeoutError extends Error {}
export class BoundedSubprocessOutputError extends Error {}

export type BoundedSubprocessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type WorkerResult = {
  kind: "ok" | "timeout" | "output" | "error";
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  message?: string;
};

const worker = fileURLToPath(new URL("./bounded-subprocess-worker.mjs", import.meta.url));

function decode(value: string | undefined): string {
  return value ? Buffer.from(value, "base64").toString("utf8") : "";
}

export function runBoundedSubprocess(
  command: string,
  args: string[],
  options: Pick<SpawnSyncOptions, "cwd" | "env" | "windowsHide"> & {
    timeoutMs: number;
    maxOutputBytes: number;
  }
): BoundedSubprocessResult {
  const encodedCommand = Buffer.from(command).toString("base64");
  const encodedArgs = Buffer.from(JSON.stringify(args)).toString("base64");
  const helper = spawnSync(process.execPath, [
    worker,
    String(options.timeoutMs),
    String(options.maxOutputBytes),
    encodedCommand,
    encodedArgs
  ], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs + 2_000,
    killSignal: "SIGKILL",
    maxBuffer: Math.max(64 * 1024, options.maxOutputBytes * 3),
    windowsHide: options.windowsHide
  });
  if ((helper.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new BoundedSubprocessTimeoutError("subprocess worker deadline exceeded");
  }
  if (helper.error) throw helper.error;
  if (helper.status !== 0) throw new Error("bounded subprocess worker failed");
  let result: WorkerResult;
  try {
    result = JSON.parse(helper.stdout) as WorkerResult;
  } catch {
    throw new Error("bounded subprocess worker returned an invalid response");
  }
  if (result.kind === "timeout") throw new BoundedSubprocessTimeoutError("subprocess deadline exceeded");
  if (result.kind === "output") {
    throw new BoundedSubprocessOutputError(`subprocess output exceeded ${options.maxOutputBytes} bytes`);
  }
  if (result.kind === "error") throw new Error(result.message || "subprocess failed to start");
  return {
    status: result.status ?? null,
    signal: result.signal ?? null,
    stdout: decode(result.stdout),
    stderr: decode(result.stderr)
  };
}
