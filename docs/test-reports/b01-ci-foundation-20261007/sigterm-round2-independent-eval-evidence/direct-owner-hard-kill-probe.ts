import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireAgentLock } from "../../../../src/cli/agent-lock";

const home = mkdtempSync(join(tmpdir(), "tokenizer-r2-owner-eval-"));
const tokenizerDir = join(home, ".tokenizer");
const lockPath = join(tokenizerDir, "agent.lock");
const statePath = join(tokenizerDir, "state.json");
let child: ChildProcess | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, message: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error(message);
}

try {
  mkdirSync(tokenizerDir, { recursive: true });
  writeFileSync(join(tokenizerDir, "config.json"), JSON.stringify({
    serverUrl: "http://127.0.0.1:9",
    projectRoots: [],
    sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false }
  }));
  child = spawn(process.execPath, ["--import", "tsx", "src/cli/index.ts", "agent", "--heartbeat-seconds", "3600", "--sync-minutes", "3600"], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: "ignore"
  });
  await waitFor(() => {
    if (!existsSync(lockPath) || !existsSync(statePath)) return false;
    try { return JSON.parse(readFileSync(statePath, "utf8"))?.agent?.status === "running"; } catch { return false; }
  }, "agent did not reach running state");

  const lockBefore = readFileSync(lockPath, "utf8");
  const owner = JSON.parse(lockBefore);
  const stateBefore = readFileSync(statePath, "utf8");
  let liveReclaimError = "";
  try { acquireAgentLock({ path: lockPath }); } catch (error) { liveReclaimError = String(error); }

  const killAccepted = child.kill("SIGKILL");
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child!.once("close", (code, signal) => resolve({ code, signal }));
  });
  let ownerAliveAfter = true;
  try { process.kill(owner.pid, 0); } catch { ownerAliveAfter = false; }

  const lockAfterKill = readFileSync(lockPath, "utf8");
  const stateAfterKill = readFileSync(statePath, "utf8");
  const recovered = acquireAgentLock({ path: lockPath });
  const successor = JSON.parse(readFileSync(lockPath, "utf8"));
  recovered.release();

  console.log(JSON.stringify({
    platform: process.platform,
    spawnedPid: child.pid,
    ownerPid: owner.pid,
    ownerMatchesSpawned: owner.pid === child.pid,
    liveReclaimRejected: liveReclaimError.includes(`already running (pid ${owner.pid})`),
    killAccepted,
    exit,
    ownerAliveAfter,
    lockPreservedAfterKill: lockAfterKill === lockBefore,
    statePreservedAfterKill: stateAfterKill === stateBefore,
    successorPid: successor.pid,
    successorTokenChanged: successor.token !== owner.token,
    lockExistsAfterRelease: existsSync(lockPath)
  }, null, 2));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  rmSync(home, { recursive: true, force: true });
}
