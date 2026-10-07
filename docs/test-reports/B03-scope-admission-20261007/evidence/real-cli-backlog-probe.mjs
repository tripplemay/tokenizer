import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const project = process.argv[2];
if (!project || !isAbsolute(project)) throw new Error("Provide an absolute isolated project worktree");
const home = mkdtempSync(join(tmpdir(), "tokenizer-admission-negative-"));
const local = join(home, ".tokenizer");
const queued = {
  source: "claude-code", sourceEventId: "synthetic-admitted-before-scope-edit",
  occurredAt: "2026-10-01T00:00:00.000Z", workspacePath: "/work/old",
  inputTokens: 10, outputTokens: 5
};
try {
  mkdirSync(local);
  writeFileSync(join(local, "config.json"), JSON.stringify({
    serverUrl: "http://127.0.0.1:9", projectRoots: [],
    sources: { claude: false, codex: false, opencode: false, aider: false, kimicode: false },
    privacy: { mode: "local-only", includePaths: ["/work/new"], excludePaths: ["/work/old"] }
  }));
  const queue = join(local, "queue.jsonl");
  writeFileSync(queue, JSON.stringify(queued) + "\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", join(project, "src/cli/index.ts"), "collect"], {
    cwd: project, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8", timeout: 15000
  });
  const rows = existsSync(queue) ? readFileSync(queue, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const preserved = rows.length === 1 && rows[0].sourceEventId === queued.sourceEventId;
  console.log(JSON.stringify({
    node: process.version, platform: process.platform, project, sourcesEnabled: 0,
    mode: "local-only", initialBacklog: 1, finalBacklog: rows.length,
    finalIds: rows.map((event) => event.sourceEventId), preserved,
    cliExit: child.status, cliSignal: child.signal, cliError: child.error?.message,
    stdout: child.stdout, stderr: child.stderr
  }, null, 2));
  if (child.status !== 0 || !preserved) process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
