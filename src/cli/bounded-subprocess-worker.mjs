import { spawn } from "node:child_process";

const [, , timeoutText, maxOutputText, encodedCommand, encodedArgs] = process.argv;
const timeoutMs = Number(timeoutText);
const maxOutputBytes = Number(maxOutputText);
const command = Buffer.from(encodedCommand, "base64").toString("utf8");
const args = JSON.parse(Buffer.from(encodedArgs, "base64").toString("utf8"));
let child;
let finished = false;
let outputBytes = 0;
const stdout = [];
const stderr = [];

function killTree() {
  if (!child?.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already exited */ }
  } else {
    try {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.unref();
    } catch { /* direct kill below remains */ }
  }
  try { child.kill("SIGKILL"); } catch { /* process already exited */ }
}

function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (result.kind !== "ok") killTree();
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
}

function collect(target, chunk) {
  if (finished) return;
  outputBytes += chunk.length;
  if (outputBytes > maxOutputBytes) {
    finish({ kind: "output" });
    return;
  }
  target.push(chunk);
}

const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
try {
  child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => collect(stdout, chunk));
  child.stderr.on("data", (chunk) => collect(stderr, chunk));
  child.on("error", (error) => finish({ kind: "error", message: error.message }));
  child.on("close", (status, signal) => finish({
    kind: "ok",
    status,
    signal,
    stdout: Buffer.concat(stdout).toString("base64"),
    stderr: Buffer.concat(stderr).toString("base64")
  }));
} catch (error) {
  finish({ kind: "error", message: error instanceof Error ? error.message : String(error) });
}
