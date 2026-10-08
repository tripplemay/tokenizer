import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Isolate the existing test's Error(stderr) projection, not the queue worker.
async function observe(label, program) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let exit;
    child.stderr.on("data", (part) => { stderr += part; });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      exit = {
        code,
        signal,
        stderrAtExit: stderr,
        projectedErrorMessage: code === 0 ? null : new Error(stderr).message
      };
    });
    child.on("close", (code, signal) => {
      resolve({ label, exit, close: { code, signal, stderrAtClose: stderr } });
    });
  });
}

assert.equal(process.platform, "darwin", "This evidence probe is macOS-only, not a Windows result");
const observations = [];
observations.push(await observe("silent-exit-17", "process.exit(17)"));
observations.push(await observe("self-SIGTERM", 'process.kill(process.pid, "SIGTERM")'));
assert.equal(observations[0].exit.code, 17);
assert.equal(observations[0].exit.signal, null);
assert.equal(observations[1].exit.code, null);
assert.equal(observations[1].exit.signal, "SIGTERM");
for (const row of observations) assert.equal(row.exit.projectedErrorMessage, "");
console.log(JSON.stringify({
  scope: "LOCAL_MACOS_ERROR_PROJECTION_ONLY_NOT_WINDOWS_OR_QUEUE_REPRODUCTION",
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  observations
}, null, 2));
