import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const before = Date.now();
const { getAgentVersion } = await import(pathToFileURL(process.env.PB_VERSION_MODULE).href);
const first = getAgentVersion();
let disk = null;
if (process.env.PB_SNAPSHOT_ROOT) {
  execFileSync(process.env.PB_REAL_GIT, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "next"], {
    cwd: process.env.PB_SNAPSHOT_ROOT, timeout: 2_000, stdio: "pipe"
  });
  disk = execFileSync(process.env.PB_REAL_GIT, ["rev-parse", "--short=12", "HEAD"], {
    cwd: process.env.PB_SNAPSHOT_ROOT, timeout: 2_000, encoding: "utf8"
  }).trim();
}
console.log(JSON.stringify({ first, second: getAgentVersion(), disk, elapsedMs: Date.now() - before }));
