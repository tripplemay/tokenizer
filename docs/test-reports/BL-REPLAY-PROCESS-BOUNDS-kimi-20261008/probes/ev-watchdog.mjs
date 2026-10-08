// Kimi F005 external watchdog. Usage:
//   node ev-watchdog.mjs <timeoutMs> <pidFileOrDash> -- <command> [args...]
// Runs the command in its OWN process group (detached). On timeout it SIGKILLs
// that group, then kills only the groups of PIDs recorded in pidFile (owned
// fixture processes). Exit 124 on watchdog fire, else the command's status.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [timeoutMs, pidFile, dash, command, ...args] = process.argv.slice(2);
if (!Number.isSafeInteger(Number(timeoutMs)) || dash !== "--" || !command) {
  console.error("usage: ev-watchdog.mjs <timeoutMs> <pidFile|-> -- <command> [args...]");
  process.exit(2);
}
const started = Date.now();
const child = spawn(command, args, { detached: true, stdio: ["ignore", "inherit", "inherit"] });
let fired = false;

function killOwnedBackstop() {
  if (pidFile && pidFile !== "-") {
    try {
      for (const line of readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean)) {
        const pid = Number(line);
        if (!Number.isSafeInteger(pid) || pid <= 1) continue;
        try { process.kill(-pid, "SIGKILL"); } catch { /* owned group gone */ }
        try { process.kill(pid, "SIGKILL"); } catch { /* owned pid gone */ }
      }
    } catch { /* no pid file */ }
  }
}

const timer = setTimeout(() => {
  fired = true;
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* probe group gone */ }
  try { child.kill("SIGKILL"); } catch { /* probe gone */ }
  setTimeout(() => { killOwnedBackstop(); console.log(JSON.stringify({ watchdog: "FIRED", timeoutMs: Number(timeoutMs) })); process.exit(124); }, 500);
}, Number(timeoutMs));

child.on("close", (status, signal) => {
  clearTimeout(timer);
  killOwnedBackstop();
  console.log(JSON.stringify({ watchdog: "clean", status, signal, elapsedMs: Date.now() - started }));
  process.exit(status ?? (signal ? 128 : 1));
});
child.on("error", (error) => {
  clearTimeout(timer);
  console.log(JSON.stringify({ watchdog: "spawn-error", error: error.message }));
  process.exit(1);
});
