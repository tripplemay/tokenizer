import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGitShim } from "../../cli/process-bounds/fixtures";

const baseline = "ba292a059184a36e4bb6c3341ac059606d24f961";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = process.argv[2];
if (!evidence || process.env.HOME !== process.env.USERPROFILE || !process.env.HOME?.includes("tk-pb-home")) {
  throw new Error("Run with an explicit evidence directory and synthetic HOME/USERPROFILE before imports");
}
if (process.platform === "win32") {
  console.log(JSON.stringify({ skipped: "Historical SIGTERM baseline reproduction is POSIX-only; native Windows current controls are retained separately." }));
  process.exit(0);
}
const root = realpathSync(mkdtempSync(join(tmpdir(), "pbb-")));
const snapshot = join(root, "snapshot");
const home = join(root, "home");
const temp = join(root, "tmp");
const pids = join(root, "pids");
mkdirSync(snapshot);
mkdirSync(join(home, ".tokenizer"), { recursive: true });
mkdirSync(temp);
let env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: temp, PB_PID_FILE: pids };
const owned = new Set<number>();

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killOwned(pid: number): void {
  try { process.kill(-pid, "SIGKILL"); } catch { /* owned POSIX group */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
}

// Independent of the new product helper. Baseline Git and descendants inherit
// this supervisor's explicitly owned group; only this group is terminated.
async function supervise(command: string, args: string[], timeoutMs: number, cwd = snapshot) {
  const started = Date.now();
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  if (child.pid) owned.add(child.pid);
  let output = "";
  let watchdog = false;
  let capExceeded = false;
  const timer = setTimeout(() => { watchdog = true; if (child.pid) killOwned(child.pid); }, timeoutMs);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    if (output.length + chunk.length <= 1024 * 1024) output += chunk;
    else { capExceeded = true; if (child.pid) killOwned(child.pid); }
  });
  const result = await new Promise<{ status: number | null; signal: string | null; error?: string }>((resolve) => {
    child.once("error", (error) => resolve({ status: null, signal: null, error: error.message }));
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
  clearTimeout(timer);
  return { ...result, elapsedMs: Date.now() - started, watchdog, capExceeded, output };
}

try {
  execFileSync("git", ["archive", "--format=tar", `--output=${join(root, "baseline.tar")}`, baseline], { cwd: repo, env, timeout: 20_000 });
  execFileSync("tar", ["-xf", join(root, "baseline.tar"), "-C", snapshot], { env, timeout: 20_000 });
  const npm = join(process.execPath, "..", "npm");
  const install = await supervise(npm, ["ci", "--cache", join(root, "npm-cache")], 180_000);
  writeFileSync(join(evidence, "baseline-npm-ci.log"), install.output);
  console.log(JSON.stringify({ stage: "fresh-baseline-npm-ci", ...install, output: "baseline-npm-ci.log", baseline }));
  if (install.status !== 0) throw new Error("Baseline fresh npm ci failed");

  for (const name of ["agent-version-probe.mjs", "replay-probe.mjs"]) {
    copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(snapshot, name));
  }
  env = { ...makeGitShim(root, env), PB_GIT_MODE: "stall", PB_DESCENDANT_FIXTURE: fileURLToPath(new URL("child.mjs", import.meta.url)),
    PB_VERSION_MODULE: join(snapshot, "src/cli/agent-version.ts"), PB_PRODUCT_ROOT: snapshot };
  const startup = await supervise(process.execPath, ["--import", "tsx", "agent-version-probe.mjs"], 4_500);
  console.log(JSON.stringify({ stage: "baseline-startup-unbounded", ...startup }));
  if (!startup.watchdog || startup.elapsedMs < 4_500) throw new Error("Baseline startup reproduction did not require watchdog");

  const file = join(root, "source.jsonl");
  writeFileSync(file, JSON.stringify({ type: "assistant", uuid: "baseline", cwd: root, timestamp: "2026-10-07T12:00:00.000Z",
    message: { role: "assistant", id: "baseline", usage: { input_tokens: 1 } } }) + "\n");
  const queue = join(home, ".tokenizer", "queue.jsonl");
  writeFileSync(queue, "");
  const config = { serverUrl: "http://127.0.0.1:9", projectRoots: [],
    sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths: [root], excludePaths: [] } };
  const request = { source: "claude-code", file, from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", maxBytes: 100_000, maxEvents: 10 };
  env.PB_REPLAY_MANIFEST = join(root, "manifest.json");
  writeFileSync(env.PB_REPLAY_MANIFEST, JSON.stringify({ request, config, queue, mode: "preview" }));
  const replay = await supervise(process.execPath, ["--import", "tsx", "replay-probe.mjs"], 11_500);
  console.log(JSON.stringify({ stage: "baseline-SIGTERM-resistant-replay", ...replay, queueUnchanged: readFileSync(queue, "utf8") === "" }));
  if (!replay.watchdog || replay.elapsedMs < 11_500) throw new Error("Baseline replay reproduction did not require watchdog");

  for (const pid of readFileSync(pids, "utf8").trim().split("\n").map(Number)) owned.add(pid);
  for (let attempt = 0; attempt < 100 && [...owned].some(alive); attempt += 1) {
    for (const pid of owned) killOwned(pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const remaining = [...owned].filter(alive);
  console.log(JSON.stringify({ stage: "owned-fixture-cleanup", trackedProcesses: owned.size, remaining }));
  if (remaining.length) throw new Error("Live owned baseline descendants remain");
} finally {
  for (const pid of owned) killOwned(pid);
  try { for (const pid of readFileSync(pids, "utf8").trim().split("\n").map(Number)) killOwned(pid); } catch { /* no shim ran */ }
  rmSync(root, { recursive: true, force: true });
}
