// Kimi F005 helper: imports the agent-version module under test and reports.
// EV_VERSION_MODULE: file URL or path of the module. EV_SNAPSHOT_ROOT: if set,
// advances the checkout after import to prove the snapshot is frozen.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const before = Date.now();
const target = process.env.EV_VERSION_MODULE;
if (!target) throw new Error("EV_VERSION_MODULE required");
const { getAgentVersion } = await import(target.startsWith("file:") ? target : pathToFileURL(target).href);
const first = getAgentVersion();
let disk = null;
if (process.env.EV_SNAPSHOT_ROOT) {
  execFileSync(process.env.EV_REAL_GIT, ["-c", "user.name=Ev", "-c", "user.email=ev@example.invalid", "commit", "--allow-empty", "-m", "two"], {
    cwd: process.env.EV_SNAPSHOT_ROOT, timeout: 2_000, stdio: "pipe"
  });
  disk = execFileSync(process.env.EV_REAL_GIT, ["rev-parse", "--short=12", "HEAD"], {
    cwd: process.env.EV_SNAPSHOT_ROOT, timeout: 2_000, encoding: "utf8"
  }).trim();
}
console.log(JSON.stringify({ first, second: getAgentVersion(), disk, elapsedMs: Date.now() - before }));
