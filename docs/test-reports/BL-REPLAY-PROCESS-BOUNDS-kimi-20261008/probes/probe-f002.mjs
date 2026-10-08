// Kimi F005 independent F002 startup SHA snapshot controls.
// Part A (stalled/overflow/invalid/short/nonzero/signal shim -> null, bounded).
// Part B (healthy real repo -> actual checkout SHA; import-time snapshot immune
// to later checkout advance). Synthetic HOME set by shell before this process.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.EV_ROOT;
const REPO = process.env.EV_REPO;
const REAL_GIT = process.env.EV_REAL_GIT;
if (!ROOT || !REPO || !REAL_GIT || !process.env.HOME?.startsWith("/private/tmp/tk-ev") || process.env.HOME !== process.env.USERPROFILE) {
  throw new Error("synthetic EV_ROOT/HOME required before imports");
}
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log("EV_F002", JSON.stringify({ name, pass, detail })); };

// Build my own shim bin: git -> ev-git-shim.mjs with node shebang.
const bin = join(ROOT, "bin");
mkdirSync(bin, { recursive: true });
const shimSource = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-git-shim.mjs");
const shim = join(bin, "git");
copyFileSync(shimSource, shim);
writeFileSync(shim, `#!${process.execPath}\n${readFileSync(shim, "utf8")}`);
chmodSync(shim, 0o755);

// A fake install tree: <install>/src/cli/{agent-version.ts,bounded-subprocess.ts,bounded-subprocess-worker.mjs}
const install = join(ROOT, "install");
mkdirSync(join(install, "src/cli"), { recursive: true });
for (const name of ["agent-version.ts", "bounded-subprocess.ts", "bounded-subprocess-worker.mjs"]) {
  copyFileSync(join(REPO, "src/cli", name), join(install, "src/cli", name));
}
const moduleUrl = pathToFileURL(join(install, "src/cli/agent-version.ts")).href;
const versionProbe = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-version-probe.mjs");
const pidFile = join(ROOT, "pids");
const shimEnv = (mode) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, EV_GIT_MODE: mode, EV_PID_FILE: pidFile, EV_REAL_GIT: REAL_GIT, EV_VERSION_MODULE: moduleUrl });

// A) Adversarial modes: version must be null and startup bounded.
// Spec budget: 2000 ms + declared allowance (2000 ms POSIX) => hard ceiling 4500 ms here.
for (const mode of ["stall", "overflow", "invalid", "short", "nonzero", "signal"]) {
  const started = Date.now();
  const out = execFileSync(process.execPath, ["--import", "tsx", versionProbe], {
    env: shimEnv(mode), encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"], cwd: REPO
  }).trim();
  const elapsed = Date.now() - started;
  const parsed = JSON.parse(out.split("\n").pop());
  record(`startup-shim-${mode}-null-bounded`, parsed.first === null && parsed.second === null && elapsed < 4_500,
    { mode, elapsed, reported: parsed.first });
}

// B) Healthy repo: exact checkout SHA at import; snapshot survives a later commit.
execFileSync(REAL_GIT, ["init", "-q"], { cwd: install, timeout: 2_000 });
execFileSync(REAL_GIT, ["-c", "user.name=Ev", "-c", "user.email=ev@example.invalid", "commit", "--allow-empty", "-qm", "one"], { cwd: install, timeout: 2_000 });
const expected = execFileSync(REAL_GIT, ["rev-parse", "--short=12", "HEAD"], { cwd: install, encoding: "utf8", timeout: 2_000 }).trim();
const healthyOut = execFileSync(process.execPath, ["--import", "tsx", versionProbe], {
  env: { ...process.env, EV_VERSION_MODULE: moduleUrl, EV_SNAPSHOT_ROOT: install, EV_REAL_GIT: REAL_GIT },
  encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"], cwd: REPO
}).trim();
const healthy = JSON.parse(healthyOut.split("\n").pop());
record("healthy-checkout-sha-and-frozen-snapshot", healthy.first === expected && healthy.second === expected && healthy.disk !== healthy.first,
  { expected, first: healthy.first, disk: healthy.disk });

// Owned-only cleanup backstop for shim pids.
try {
  for (const line of readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean)) {
    const pid = Number(line);
    try { process.kill(-pid, "SIGKILL"); } catch { /* owned group only */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* reaped */ }
  }
} catch { /* none */ }
const failed = results.filter((r) => !r.pass);
console.log("EV_F002_SUMMARY", JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
