import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(realpathSync(tmpdir()), "composition-exact-cli-"));
const home = join(root, "home");
const repo = join(root, "realrepo");
const bin = join(root, "stubbin");
const marker = join(root, "git-marker");
const source = join(root, "gitsource.jsonl");
const queue = join(home, ".tokenizer", "queue.jsonl");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

mkdirSync(join(home, ".tokenizer"), { recursive: true });
mkdirSync(repo); mkdirSync(bin);
function realGit(args: string[]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}
realGit(["init", "-q", "-b", "main"]);
realGit(["-c", "user.email=probe@invalid", "-c", "user.name=probe", "commit", "-q", "--allow-empty", "-m", "init"]);
writeFileSync(source, `${JSON.stringify({
  type: "assistant", uuid: "d1", cwd: repo, timestamp: "2026-10-07T12:00:00.000Z", sessionId: "s-deadline",
  message: { role: "assistant", id: "msg-d1", model: "claude-probe", usage: { input_tokens: 2, output_tokens: 2 } }
})}\n`);
writeFileSync(queue, `${JSON.stringify({ source: "claude-code", sourceEventId: "deadline-sentinel", occurredAt: "2026-10-01T00:00:00.000Z" })}\n`);
writeFileSync(join(home, ".tokenizer", "config.json"), `${JSON.stringify({
  serverUrl: "http://127.0.0.1:9", projectRoots: [],
  sources: { claude: true, codex: false, opencode: false, aider: false, kimicode: false },
  privacy: { mode: "local-only", includePaths: [root], excludePaths: [] }
})}\n`);
writeFileSync(join(bin, "git"), `#!/bin/sh\necho entered >> "${marker}"\nsleep 30\nexit 1\n`, { mode: 0o700 });

const args = ["replay", "--source", "claude-code", "--file", source,
  "--from", "2026-10-07T00:00:00.000Z", "--to", "2026-10-08T00:00:00.000Z",
  "--max-bytes", "100000", "--max-events", "10"];
const baseline = sha(queue);
function run(label: string, stalled: boolean, extra: string[] = []) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args, ...extra], {
    cwd: process.cwd(), encoding: "utf8", timeout: 50_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: stalled ? `${bin}:${process.env.PATH}` : process.env.PATH }
  });
  return {
    label, elapsedMs: Date.now() - started, status: result.status,
    errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code ?? null,
    markerCalls: readFileSync(marker, "utf8").split("\n").filter(Boolean).length,
    queueSha256: sha(queue), queueUnchanged: sha(queue) === baseline,
    stdout: result.stdout.slice(0, 1000), stderr: result.stderr.slice(0, 1000)
  };
}

try {
  writeFileSync(marker, "");
  const t1 = run("T1-stalled-dry-run", true);
  const preview = run("T2-native-preview", false);
  const digest = JSON.parse(preview.stdout).planDigest as string;
  const t2 = run("T2-stalled-execute", true, ["--execute", "--confirm", digest]);
  console.log(JSON.stringify({ candidate: "116a1fffb2bd8c800f721adf1cd99653981da2df", node: process.version,
    shim: "#!/bin/sh; echo entered >> $MARKER; sleep 30; exit 1", t1, preview, t2 }, null, 2));
  if ([t1, t2].some((item) => item.status !== 1 || !item.stderr.includes("Git enrichment exceeded 10000ms deadline") ||
      !item.queueUnchanged || item.markerCalls < 1)) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
