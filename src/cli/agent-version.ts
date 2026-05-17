import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to the install dir (~/.tokenizer/app), which is a clone of the
// upstream repo. `git rev-parse` gives us the commit the agent is actually
// running, which is what the server-side diagnostics surface needs.
function installRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

let cached: string | null | undefined;

export function getAgentVersion(): string | null {
  if (cached !== undefined) return cached;
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: installRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    cached = sha || null;
  } catch {
    cached = null;
  }
  return cached;
}
