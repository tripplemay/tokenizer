import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

if (process.versions.node.split(".")[0] !== "22") throw new Error("Run with Node 22");
const directory = "docs/test-reports/BL-PRIVACY-QUEUE-CLOSEOUT-generator-20261008";
const prefix = process.env.TOKENIZER_CHECK_PREFIX ?? "final";
if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error("Invalid evidence prefix");
// tsx binds a Unix socket below TMPDIR; macOS's default temp path is too long.
const root = mkdtempSync(join(realpathSync(process.platform === "darwin" ? "/tmp" : tmpdir()), "tk-closeout-"));
const home = join(root, "home");
const temp = join(root, "tmp");
mkdirSync(home); mkdirSync(temp);
const env = {
  ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
  HOME: home, USERPROFILE: home, TMPDIR: temp,
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:9/tokenizer_scratch",
  NEXT_TELEMETRY_DISABLED: "1"
};
for (const key of Object.keys(env)) {
  if (/^EVAL_.*DB/.test(key) || key === "CONTRACT_FIXTURES_DIR") delete env[key];
}
const focused = [
  "tests/cli/b07", "tests/cli/b03", "tests/cli/replay", "tests/cli/queue-merge.test.ts",
  "tests/cli/agent-sync-checkpoint.test.ts", "tests/evaluator/bl-homepage-freshness-f002-f003.test.ts",
  "tests/ci/b07", "tests/ci/b06-pg16-workflow-gate.test.ts",
  "tests/ci/b05-recovery-source.test.ts", "tests/evaluator/b05-evidence-retention-round2.test.ts"
];
const report = (name) => ["--reporter=default", "--reporter=json", `--outputFile=${directory}/${prefix}-${name}.json`];
const stages = [
  ["lint", ["run", "lint"]],
  ["verify", ["run", "verify"]],
  ["focused", ["exec", "--", "vitest", "run", ...focused, "--maxWorkers=2", ...report("focused")]],
  ["full-controlled", ["test", "--", "--maxWorkers=2", ...report("full-controlled")]],
  ["full-default", ["test", "--", ...report("full-default")]],
  ["build", ["run", "build"]]
];
const results = [];
const selected = new Set(process.argv.slice(2));
for (const name of selected) {
  if (!stages.some(([stage]) => stage === name)) throw new Error(`Unknown stage: ${name}`);
}
for (const [name, args] of stages) {
  if (selected.size && !selected.has(name)) continue;
  const log = `${directory}/${prefix}-${name}.log`;
  const handle = openSync(log, "w");
  const startedAt = new Date().toISOString();
  const started = performance.now();
  console.log(`START ${name} ${startedAt}`);
  const result = spawnSync(join(dirname(process.execPath), "npm"), args, {
    cwd: process.cwd(), env, stdio: ["ignore", handle, handle], timeout: 600_000
  });
  closeSync(handle);
  results.push({ name, command: ["npm", ...args], startedAt, durationMs: Math.round(performance.now() - started), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, log });
  writeFileSync(`${directory}/${prefix}-command-results.json`, JSON.stringify({ node: process.version, execPath: process.execPath, platform: process.platform, syntheticRoot: root, sequential: true, results }, null, 2) + "\n");
  console.log(`END ${name} exit=${result.status}`);
}
if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
