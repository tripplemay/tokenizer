// Kimi F005 independent F003 replay refusal controls.
// - Synthetic HOME/USERPROFILE with EXPLICIT queue path asserted BEFORE imports.
// - Each control uses its OWN workspace dir/source file because git.ts caches
//   GitInfo per workspace path process-wide.
// - Stalled SIGTERM-resistant git tree refuses preview AND a valid-confirmation
//   execute; queue/cursor/config stay byte-identical; no live owned processes.
// - Delayed shim proves one shared operation deadline (no per-call renewal).
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.EV_ROOT;
const REPO = process.env.EV_REPO;
const REAL_GIT = process.env.EV_REAL_GIT;
const HOME_DIR = process.env.HOME;
if (!ROOT || !REPO || !REAL_GIT || !HOME_DIR?.startsWith("/private/tmp/tk-ev") || HOME_DIR !== process.env.USERPROFILE) {
  throw new Error("synthetic EV_ROOT/HOME required before imports");
}
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log("EV_F003", JSON.stringify({ name, pass, detail })); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// My own shim bin (independent fixture, not Generator's).
const bin = join(ROOT, "bin");
mkdirSync(bin, { recursive: true });
const shimSource = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-git-shim.mjs");
const descendant = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-child.mjs");
const shim = join(bin, "git");
copyFileSync(shimSource, shim);
writeFileSync(shim, `#!${process.execPath}\n${readFileSync(shim, "utf8")}`);
chmodSync(shim, 0o755);

// Explicit synthetic state with known bytes.
const stateDir = join(HOME_DIR, ".tokenizer");
mkdirSync(stateDir, { recursive: true });
const queue = join(stateDir, "queue.jsonl");
const cursor = join(stateDir, "cursor.json");
const configFile = join(stateDir, "config.json");
writeFileSync(queue, JSON.stringify({ source: "claude-code", sourceEventId: "ev-retained", occurredAt: "2026-10-07T12:00:00.000Z" }) + "\n");
writeFileSync(cursor, '{"cursor":"ev-unchanged"}\n');
const config = { serverUrl: "http://127.0.0.1:9", projectRoots: [],
  sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
  privacy: { mode: "local-only", includePaths: [ROOT], excludePaths: [] } };
writeFileSync(configFile, JSON.stringify(config));

// One workspace+source per control (git.ts caches per workspace path).
const makeSource = (ws) => {
  mkdirSync(ws, { recursive: true });
  const file = join(ws, "ev-source.jsonl");
  writeFileSync(file, JSON.stringify({ type: "assistant", uuid: `ev-${ws}`, cwd: ws, timestamp: "2026-10-07T12:00:00.000Z",
    message: { role: "assistant", id: `ev-${ws}`, content: "EV-RAW-MESSAGE-CANARY-KIMI", usage: { input_tokens: 5 } } }) + "\n");
  return { source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10 };
};

// Imports happen only after HOME/queue are pinned.
const { queuePath } = await import(pathToFileURL(join(REPO, "src/cli/config.ts")).href);
if (queuePath !== queue) throw new Error(`queue path mismatch: ${queuePath} != ${queue}`);
const { dryRunBoundedReplay, executeBoundedReplay } = await import(pathToFileURL(join(REPO, "src/cli/replay.ts")).href);
const { planBoundedReplay } = await import(pathToFileURL(join(REPO, "src/cli/replay-contract.ts")).href);

const stateBytes = () => [readFileSync(queue), readFileSync(cursor), readFileSync(configFile)];
const pidFile = join(ROOT, "pids");
const pids = () => { try { return readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean).map(Number); } catch { return []; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const basePath = process.env.PATH;
const shimOn = (mode) => { process.env.PATH = `${bin}:${basePath}`; process.env.EV_GIT_MODE = mode; process.env.EV_PID_FILE = pidFile; process.env.EV_REAL_GIT = REAL_GIT; };
const shimOff = () => { process.env.PATH = basePath; delete process.env.EV_GIT_MODE; delete process.env.EV_DESCENDANT; };

// 1. Healthy preview on a non-repo workspace: ordinary absent-git enrichment
// still works and stays read-only.
const ws1 = makeSource(join(ROOT, "ws1"));
shimOff();
const beforeHealthy = stateBytes();
const healthy = dryRunBoundedReplay(planBoundedReplay(ws1), config);
record("healthy-preview-absent-git-readonly", healthy.wouldAdmit === 1 && stateBytes().every((b, i) => b.equals(beforeHealthy[i])),
  { wouldAdmit: healthy.wouldAdmit });

// Fresh-process runner: one replay invocation per child (no in-process git
// cache), manifest-driven, synthetic env inherited from this probe.
const replayProbe = join(REPO, "docs/test-reports/BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/probes/ev-replay-probe.mjs");
const runChild = (wsRequest, mode, confirmation, extraEnv = {}) => {
  const manifest = join(ROOT, `manifest-${mode}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(manifest, JSON.stringify({ request: wsRequest, config, queue, mode, confirmation }));
  const out = execFileSync(process.execPath, ["--import", "tsx", replayProbe], {
    env: { ...process.env, EV_REPLAY_MANIFEST: manifest, ...extraEnv },
    encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"], cwd: REPO
  }).trim();
  return JSON.parse(out.split("\n").pop());
};
const shimEnvFor = (mode, withDescendant = false) => ({
  PATH: `${bin}:${basePath}`, EV_GIT_MODE: mode, EV_PID_FILE: pidFile, EV_REAL_GIT: REAL_GIT,
  ...(withDescendant ? { EV_DESCENDANT: descendant } : {})
});

// 2. Stalled SIGTERM-resistant git tree (with pipe-holding descendant) refuses
// PREVIEW inside the deadline; state byte-identical; no live owned processes.
const ws2 = makeSource(join(ROOT, "ws2"));
let before = stateBytes();
let childOut = runChild(ws2, "preview", undefined, shimEnvFor("stall", true));
await sleep(700);
let live = pids().filter(alive);
record("preview-refused-resistant-tree-state-identical", /deadline/i.test(String(childOut.error)) && childOut.elapsedMs < 10_000 &&
  stateBytes().every((b, i) => b.equals(before[i])) && pids().length >= 2 && live.length === 0 &&
  !String(childOut.error).includes("EV-RAW-MESSAGE-CANARY-KIMI") && !String(childOut.error).includes("EV-RAW-GIT-CANARY-KIMI"),
  { error: String(childOut.error).slice(0, 120), elapsed: childOut.elapsedMs, tracked: pids().length, live: live.length });

// 3. Same stalled tree refuses EXECUTE with a VALID confirmation digest (taken
// from a healthy preview of the SAME file in its own fresh process); state
// stays byte-identical.
const ws2b = makeSource(join(ROOT, "ws2b"));
const healthyDigest = runChild(ws2b, "preview").result.planDigest;
before = stateBytes();
childOut = runChild(ws2b, "execute", healthyDigest, shimEnvFor("stall", true));
await sleep(700);
live = pids().filter(alive);
record("execute-refused-resistant-tree-valid-digest-state-identical", /deadline/i.test(String(childOut.error)) && childOut.elapsedMs < 10_000 &&
  stateBytes().every((b, i) => b.equals(before[i])) && live.length === 0,
  { error: String(childOut.error).slice(0, 120), elapsed: childOut.elapsedMs, tracked: pids().length, live: live.length });

// 4. Shared operation deadline: real repo, each git call burns 2.5 s; the 4
// sequential enrichment calls must trip the single 10 s deadline. Runs in a
// fresh child so the ws3 cache entry cannot mask later controls.
const ws3Path = join(ROOT, "ws3");
const ws3 = makeSource(ws3Path);
execFileSync(REAL_GIT, ["init", "-q"], { cwd: ws3Path, timeout: 2_000 });
execFileSync(REAL_GIT, ["-c", "user.name=Ev", "-c", "user.email=ev@example.invalid", "commit", "--allow-empty", "-qm", "ev"], { cwd: ws3Path, timeout: 2_000 });
const trackedBefore = pids().length;
childOut = runChild(ws3, "preview", undefined, { ...shimEnvFor("delay"), EV_GIT_DELAY_MS: "2500" });
record("shared-deadline-no-renewal-across-git-calls", /deadline/i.test(String(childOut.error)) && childOut.elapsedMs < 10_000 && pids().length - trackedBefore > 1,
  { error: String(childOut.error).slice(0, 120), elapsed: childOut.elapsedMs, gitInvocations: pids().length - trackedBefore });

// 5. Output-overflowing git refuses; error carries no raw stderr canary.
const ws4 = makeSource(join(ROOT, "ws4"));
before = stateBytes();
childOut = runChild(ws4, "preview", undefined, shimEnvFor("overflow"));
record("git-overflow-refused-no-canary", !!childOut.error && !String(childOut.error).includes("EV-RAW-GIT-CANARY-KIMI") &&
  stateBytes().every((b, i) => b.equals(before[i])), { error: String(childOut.error).slice(0, 120) });

// 6. Healthy end-to-end control with REAL git (repo + private-cred remote):
// preview read-only; confirmed execute admits one minimized event; queue holds
// no canary/private material; cursor/config untouched. Fresh children so the
// admitted event carries this workspace's own enrichment.
const ws5Path = join(ROOT, "ws5");
const ws5 = makeSource(ws5Path);
for (const args of [["init", "-q"], ["-c", "user.name=Ev", "-c", "user.email=ev@example.invalid", "commit", "--allow-empty", "-qm", "ev"],
  ["remote", "add", "origin", "https://evuser:EV-PRIVATE-TOKEN-KIMI@git.example/team/ev-fixture.git"]]) {
  execFileSync(REAL_GIT, args, { cwd: ws5Path, timeout: 2_000, stdio: "pipe" });
}
before = stateBytes();
const livePreview = runChild(ws5, "preview").result;
const previewUnchanged = stateBytes().every((b, i) => b.equals(before[i]));
const executed = runChild(ws5, "execute", livePreview.planDigest).result;
const queueText = readFileSync(queue, "utf8");
const admitted = queueText.trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.workspacePath === ws5Path);
record("healthy-execute-admits-minimized-event", previewUnchanged && executed.admitted === 1 && !!admitted &&
  /^[0-9a-f]{40}$/.test(admitted.gitCommit ?? "") && admitted.gitRemote === "https://git.example/team/ev-fixture.git" &&
  !/EV-RAW-MESSAGE-CANARY-KIMI|EV-PRIVATE-TOKEN-KIMI|evuser/.test(queueText) &&
  readFileSync(cursor).equals(before[1]) && readFileSync(configFile).equals(before[2]),
  { previewUnchanged, admitted: executed.admitted, gitCommit: admitted?.gitCommit?.slice(0, 12), gitRemote: admitted?.gitRemote });

// Owned-only cleanup backstop.
for (const pid of pids()) {
  try { process.kill(-pid, "SIGKILL"); } catch { /* owned group only */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* reaped */ }
}
const failed = results.filter((r) => !r.pass);
console.log("EV_F003_SUMMARY", JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
