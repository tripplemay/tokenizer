// Kimi F005 independent git shim. Placed first on PATH as `git` (POSIX).
// Modes via EV_GIT_MODE; records its pid for owned-only cleanup.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

if (process.env.EV_PID_FILE) appendFileSync(process.env.EV_PID_FILE, `${process.pid}\n`);
setTimeout(() => process.exit(93), 20_000).unref();
const mode = process.env.EV_GIT_MODE ?? "passthrough";

if (mode === "stall") {
  // SIGTERM-resistant; optionally spawns a SIGTERM-resistant descendant that
  // inherits pipes (EV_DESCENDANT points at ev-child.mjs).
  process.on("SIGTERM", () => {});
  if (process.env.EV_DESCENDANT) {
    spawn(process.execPath, [process.env.EV_DESCENDANT, "resist", process.env.EV_PID_FILE], { stdio: "inherit" });
  }
  setInterval(() => {}, 100);
} else if (mode === "overflow") {
  process.stderr.write("EV-RAW-GIT-CANARY-KIMI\n");
  process.stdout.write("z".repeat(256 * 1_024));
} else if (mode === "invalid") {
  process.stdout.write("%%not-a-sha%%\n");
} else if (mode === "short") {
  process.stdout.write("deadbee\n");
} else if (mode === "nonzero") {
  process.stdout.write("c".repeat(12) + "\n");
  process.exitCode = 3;
} else if (mode === "signal") {
  process.kill(process.pid, "SIGTERM");
} else if (mode === "delay") {
  // Each invocation burns EV_GIT_DELAY_MS of wall time to prove successive
  // calls share ONE operation deadline (no per-call renewal).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.EV_GIT_DELAY_MS ?? 2_500));
  const result = spawnSync(process.env.EV_REAL_GIT, process.argv.slice(2), { encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
} else {
  const result = spawnSync(process.env.EV_REAL_GIT, process.argv.slice(2), { encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
}
