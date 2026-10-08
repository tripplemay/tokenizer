import { spawn } from "node:child_process";
import { writeSync } from "node:fs";

const { command, args, cwd, timeoutMs, maxOutputBytes, cleanupMs } = JSON.parse(process.argv[2]);
let child;
let finished = false;
let closed = false;
let outputBytes = 0;
const stdout = [];
const stderr = [];

async function killTree() {
  if (!child?.pid) return true;
  const deadline = Date.now() + cleanupMs;
  let successful = true;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { successful = error.code === "ESRCH"; }
  } else {
    successful = await new Promise((resolve) => {
      let settled = false;
      let killer;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(limit);
        resolve(ok);
      };
      const limit = setTimeout(() => {
        try { killer?.kill("SIGKILL"); } catch { /* killer already exited */ }
        done(false);
      }, Math.max(1, cleanupMs - 100));
      try {
        killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore", windowsHide: true
        });
        killer.once("error", () => done(false));
        killer.once("close", (status) => done(status === 0));
      } catch {
        done(false);
      }
    });
  }
  try { child.kill("SIGKILL"); } catch { /* direct-child fallback */ }
  while (!closed && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  return successful && closed;
}

async function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (result.kind !== "ok" && !await killTree()) result = { kind: "supervision" };
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
}

function collect(target, chunk) {
  if (finished) return;
  outputBytes += chunk.length;
  if (outputBytes > maxOutputBytes) {
    void finish({ kind: "output" });
    return;
  }
  target.push(chunk);
}

const timer = setTimeout(() => void finish({ kind: "timeout" }), timeoutMs);
try {
  child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true
  });
  // Synchronous publication permits the parent watchdog to clean the owned
  // group if this worker fails after launch. Zero denotes no spawned child.
  writeSync(1, `${child.pid ?? 0}\n`);
  child.stdout.on("data", (chunk) => collect(stdout, chunk));
  child.stderr.on("data", (chunk) => collect(stderr, chunk));
  child.on("error", (error) => void finish({ kind: "launch", code: error.code }));
  child.on("close", (status, signal) => {
    closed = true;
    void finish({ kind: "ok", status, signal,
      stdout: Buffer.concat(stdout).toString("base64"),
      stderr: Buffer.concat(stderr).toString("base64")
    });
  });
} catch (error) {
  if (!child) writeSync(1, "0\n");
  void finish({ kind: "launch", code: error.code });
}
