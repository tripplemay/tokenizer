import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

if (process.env.PB_PID_FILE) appendFileSync(process.env.PB_PID_FILE, `${process.pid}\n`);
const mode = process.env.PB_GIT_MODE;
setTimeout(() => process.exit(91), 15_000).unref();
if (mode === "stall") {
  process.on("SIGTERM", () => {});
  if (process.env.PB_DESCENDANT_FIXTURE) {
    spawn(process.execPath, [process.env.PB_DESCENDANT_FIXTURE, "resistant", process.env.PB_PID_FILE], { stdio: "inherit" });
  }
  setInterval(() => {}, 100);
} else if (mode === "overflow") {
  process.stderr.write("RAW-GIT-STDERR-CANARY\n");
  process.stdout.write("a".repeat(128 * 1_024));
} else if (mode === "invalid") {
  process.stdout.write("not-a-git-sha\n");
} else if (mode === "short") {
  process.stdout.write("abc123\n");
} else if (mode === "nonzero") {
  process.stdout.write("a".repeat(12));
  process.exitCode = 1;
} else if (mode === "signal") {
  process.kill(process.pid, "SIGTERM");
} else if (mode === "valid") {
  process.stdout.write("a".repeat(12));
} else {
  if (process.env.PB_GIT_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.PB_GIT_DELAY_MS));
  const result = spawnSync(process.env.PB_REAL_GIT, process.argv.slice(2), { encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
}
