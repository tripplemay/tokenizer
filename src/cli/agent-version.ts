import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedSubprocess } from "./bounded-subprocess";

// Resolves to the install dir (~/.tokenizer/app), which is a clone of the
// upstream repo. `git rev-parse` gives us the commit the agent is actually
// running, which is what the server-side diagnostics surface needs.
function installRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

// A copied Node executable used as git on Windows can take over one second to
// start under CI load. Keep this bounded well below the former 30-second stall
// while allowing the startup SHA snapshot to succeed on native Windows.
const STARTUP_VERSION_TIMEOUT_MS = 2_000;

// Captured at module load (effectively process startup). A long-running
// daemon that started BEFORE a later `git pull` must keep reporting its
// startup SHA, not the post-pull on-disk SHA — otherwise stale daemons
// falsely appear up-to-date on the dashboard. Lazy/first-call evaluation
// races with install.sh's pull when the first heartbeat lands after the
// pull but before the daemon is actually restarted.
const cached: string | null = (() => {
  try {
    const result = runBoundedSubprocess("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: installRoot(),
      timeoutMs: STARTUP_VERSION_TIMEOUT_MS,
      maxOutputBytes: 128,
      windowsHide: true
    });
    if (result.status !== 0 || result.signal !== null) return null;
    const sha = result.stdout.trim();
    return sha || null;
  } catch {
    return null;
  }
})();

export function getAgentVersion(): string | null {
  return cached;
}
