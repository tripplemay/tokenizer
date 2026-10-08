// Kimi F005 independent F001 adversarial controls for runBoundedSubprocess.
// Synthetic HOME/USERPROFILE/TMPDIR are set by the shell BEFORE this process
// started; this probe verifies isolation before importing product code.
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.EV_ROOT;
const REPO = process.env.EV_REPO;
if (!ROOT || !REPO || !process.env.HOME?.startsWith("/private/tmp/tk-ev") || process.env.HOME !== process.env.USERPROFILE) {
  throw new Error("synthetic EV_ROOT/HOME/USERPROFILE required before imports");
}
const pidFile = join(ROOT, "pids");
const child = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-child.mjs");
const killer = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-worker-killer.mjs");
const env = { ...process.env };

const { runBoundedSubprocess, SUBPROCESS_TOTAL_ALLOWANCE_MS, BoundedSubprocessTimeoutError,
  BoundedSubprocessOutputError, BoundedSubprocessLaunchError, BoundedSubprocessSupervisionError } =
  await import(pathToFileURL(join(REPO, "src/cli/bounded-subprocess.ts")).href);

const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log("EV_F001", JSON.stringify({ name, pass, detail })); };
const pids = () => { try { return readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean).map(Number); } catch { return []; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (mode, timeoutMs = 500, maxOutputBytes = 1_024, extraEnv = {}, args = ["one;two", "three four"]) =>
  runBoundedSubprocess(process.execPath, [child, mode, pidFile, ...args], { cwd: ROOT, env: { ...env, ...extraEnv }, timeoutMs, maxOutputBytes });

// 1. Ordinary success: argv (no shell), cwd, env, stdout/stderr preserved.
try {
  const r = run("normal", 3_000);
  const parsed = JSON.parse(r.stdout);
  record("normal-preserves-argv-cwd-env", r.status === 0 && r.signal === null && r.stderr === "ev-stderr-ok" &&
    parsed.cwd === ROOT && parsed.home === env.HOME && parsed.argv.join("|") === "one;two|three four", { status: r.status, stderr: r.stderr });
} catch (e) { record("normal-preserves-argv-cwd-env", false, String(e)); }

// 2. Ordinary nonzero exit is NOT a launch failure.
try {
  const r = run("nonzero", 3_000);
  record("nonzero-vs-launch", r.status === 17 && r.signal === null && r.stdout === "ev-ordinary-failure", { status: r.status });
} catch (e) { record("nonzero-vs-launch", false, String(e)); }

// 3. Missing executable -> typed launch failure (not supervision).
try {
  runBoundedSubprocess(join(ROOT, "no-such-exe"), [], { cwd: ROOT, env, timeoutMs: 500, maxOutputBytes: 1_024 });
  record("missing-executable", false, "no throw");
} catch (e) { record("missing-executable", e instanceof BoundedSubprocessLaunchError, e.constructor.name); }

// 4. Missing TARGET cwd -> launch ENOENT (target failure, not supervisor failure).
try { runBoundedSubprocess(process.execPath, [child, "normal", pidFile], { cwd: join(ROOT, "gone"), env, timeoutMs: 500, maxOutputBytes: 1_024 }); record("target-cwd-enoent", false, "no throw"); }
catch (e) { record("target-cwd-enoent", e instanceof BoundedSubprocessLaunchError && e.code === "ENOENT", `${e.constructor.name}:${e.code}`); }

// 5. Invalid budgets rejected BEFORE any spawn (pid file grows by zero).
let pre = true;
const spawnedBefore = pids().length;
for (const bad of [0, -1, NaN, Infinity, 0.5, 2 ** 32]) {
  try { run("normal", bad); pre = false; } catch (e) { if (!(e instanceof RangeError)) pre = false; }
  try { run("normal", 500, bad); pre = false; } catch (e) { if (!(e instanceof RangeError)) pre = false; }
}
record("invalid-budgets-rejected-preserving-zero-spawns", pre && pids().length === spawnedBefore, { newSpawns: pids().length - spawnedBefore });

// 6. SIGTERM-resistant child: timeout typed, bounded wall time, group reaped.
{
  const trackedBefore = pids().length;
  const start = Date.now();
  let caught;
  try { run("resist"); } catch (e) { caught = e; }
  const elapsed = Date.now() - start;
  await sleep(700); // allow group kill to settle
  const live = pids().filter(alive);
  record("sigterm-resistant-timeout-and-reap", caught instanceof BoundedSubprocessTimeoutError &&
    elapsed < 500 + SUBPROCESS_TOTAL_ALLOWANCE_MS + 500 && live.length === 0 && pids().length - trackedBefore === 1,
    { error: caught?.constructor.name, elapsed, newTracked: pids().length - trackedBefore, live: live.length });
}

// 7. SIGTERM-resistant DESCENDANT retaining inherited pipes after parent exit:
// must still time out (no close-hang) and reap the whole owned group.
{
  const trackedBefore = pids().length;
  const start = Date.now();
  let caught;
  try { run("resist-tree"); } catch (e) { caught = e; }
  const elapsed = Date.now() - start;
  await sleep(700);
  const tracked = pids().length - trackedBefore;
  const live = pids().filter(alive);
  record("descendant-inherited-pipes-timeout-and-reap", caught instanceof BoundedSubprocessTimeoutError &&
    elapsed < 500 + SUBPROCESS_TOTAL_ALLOWANCE_MS + 500 && tracked === 2 && live.length === 0,
    { error: caught?.constructor.name, elapsed, newTracked: tracked, live: live.length });
}

// 8. Output overflow: typed error, raw stderr canary never leaks, child reaped.
{
  let caught;
  try { run("overflow", 3_000, 2_048); } catch (e) { caught = e; }
  await sleep(700);
  const live = pids().filter(alive);
  record("output-overflow-typed-no-canary-reaped", caught instanceof BoundedSubprocessOutputError &&
    !String(caught).includes("EV-RAW-STDERR-CANARY-KIMI") && live.length === 0,
    { error: caught?.constructor.name, canary: String(caught).includes("EV-RAW-STDERR-CANARY-KIMI"), live: live.length });
}

// 9. Combined stdout+stderr charged against ONE budget.
{
  let caught;
  try { run("mixed-budget", 3_000, 1_024); } catch (e) { caught = e; }
  const ok1400 = run("mixed-budget", 3_000, 1_400);
  record("combined-stream-budget", caught instanceof BoundedSubprocessOutputError &&
    ok1400.stdout.length + ok1400.stderr.length === 1_400, { error: caught?.constructor.name });
}

// 10. Worker dies AFTER publishing the owned child PID (supervision failure
// mid-flight): parent must SIGKILL the published group and refuse with a
// supervision error that carries no raw worker output.
{
  let caught;
  try { run("resist", 3_000, 1_024, { NODE_OPTIONS: `--import=${pathToFileURL(killer).href}` }); } catch (e) { caught = e; }
  await sleep(700);
  const tracked = pids();
  const live = tracked.filter(alive);
  record("worker-death-after-publish-kills-owned-group", caught instanceof BoundedSubprocessSupervisionError &&
    !String(caught).includes("EV-RAW-WORKER-CANARY-KIMI") && live.length === 0,
    { error: caught?.constructor.name, canary: String(caught).includes("EV-RAW-WORKER-CANARY-KIMI"), tracked: tracked.length, live: live.length });
}

// 11. Termination signal preserved for ordinary children (POSIX).
{
  try {
    const r = run("sigterm-self", 3_000);
    record("signal-preserved", r.status === null && r.signal === "SIGTERM", { status: r.status, signal: r.signal });
  } catch (e) { record("signal-preserved", false, String(e)); }
}

// Owned-only cleanup backstop.
for (const pid of pids()) {
  try { process.kill(-pid, "SIGKILL"); } catch { /* owned group only */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ }
}
const failed = results.filter((r) => !r.pass);
console.log("EV_F001_SUMMARY", JSON.stringify({ total: results.length, failed: failed.length, allowance: SUBPROCESS_TOTAL_ALLOWANCE_MS }));
process.exit(failed.length ? 1 : 0);
