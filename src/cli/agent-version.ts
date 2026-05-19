import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to the install dir (~/.tokenizer/app), which is a clone of the
// upstream repo. `git rev-parse` gives us the commit the agent is actually
// running, which is what the server-side diagnostics surface needs.
function installRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

// Captured at module load (effectively process startup). A long-running
// daemon that started BEFORE a later `git pull` must keep reporting its
// startup SHA, not the post-pull on-disk SHA — otherwise stale daemons
// falsely appear up-to-date on the dashboard. Lazy/first-call evaluation
// races with install.sh's pull when the first heartbeat lands after the
// pull but before the daemon is actually restarted.
const cached: string | null = (() => {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: installRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
})();

export function getAgentVersion(): string | null {
  return cached;
}
