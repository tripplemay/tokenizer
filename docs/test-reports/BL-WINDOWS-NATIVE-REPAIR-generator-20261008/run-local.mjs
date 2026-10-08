import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const report = new URL("./", import.meta.url).pathname;
const nodeBin = "/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin";
const home = "/private/tmp/wnrg-home-20261008";
const temporary = "/private/tmp/wnrg-tmp-20261008";
mkdirSync(home, { recursive: true });
mkdirSync(temporary, { recursive: true });
const env = { ...process.env, PATH: `${nodeBin}:${process.env.PATH}`, HOME: home, TMPDIR: temporary,
  NEXT_TELEMETRY_DISABLED: "1" };
const attempt = process.argv[3] || "1";
const commands = {
  install: ["npm", ["ci"]],
  lint: ["npm", ["run", "lint"]],
  verify: ["npm", ["run", "verify"]],
  build: ["npm", ["run", "build"]],
  full: ["npm", ["test", "--", "--reporter=default", "--reporter=json", `--outputFile=${join(report, `full-${attempt}-vitest.json`)}`]],
  focused: ["npx", ["vitest", "run", "tests/cli/windows-native-repair", "tests/ci/windows-native-repair-workflow.test.ts",
    "tests/ci/vps-host-preflight.test.ts", "tests/cli/privacy.test.ts", "tests/cli/privacy-scope-safety.test.ts",
    "tests/cli/process-bounds/bounded-subprocess.test.ts", "--reporter=default", "--reporter=json",
    `--outputFile=${join(report, `focused-${attempt}-vitest.json`)}`]],
  "privacy-controls": ["npx", ["vitest", "run", "tests/cli/windows-native-repair", "--reporter=verbose"]],
  "workflow-controls": ["npx", ["vitest", "run", "tests/ci/windows-native-repair-workflow.test.ts", "--reporter=verbose"]]
};
const label = process.argv[2];
const command = commands[label];
if (!command) throw new Error(`unknown check: ${label}`);
if (["stdout.log", "stderr.log", "json"].some((suffix) => existsSync(join(report, `${label}-${attempt}.${suffix}`)))) {
  throw new Error(`refusing to overwrite retained check: ${label}-${attempt}`);
}
const start = new Date().toISOString();
const sourceFiles = ["src/cli/privacy.ts", "src/cli/bounded-subprocess-worker.mjs", "src/cli/bounded-subprocess.ts",
  "tests/ci/vps-host-preflight.test.ts", "tests/ci/windows-native-repair-workflow.test.ts",
  "tests/cli/windows-native-repair/privacy-ancestor.test.ts", "package.json", "package-lock.json", "vitest.config.ts"];
const source = { head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  files: sourceFiles.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) };
const result = spawnSync(command[0], command[1], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
writeFileSync(join(report, `${label}-${attempt}.stdout.log`), result.stdout ?? "");
writeFileSync(join(report, `${label}-${attempt}.stderr.log`), result.stderr ?? "");
const record = { label, attempt, start, end: new Date().toISOString(), command, cwd: process.cwd(),
  source,
  runtime: { node: process.version, uv: process.versions.uv, platform: process.platform, arch: process.arch },
  environment: { HOME: home, TMPDIR: temporary, nodeBin, NEXT_TELEMETRY_DISABLED: "1" },
  status: result.status, signal: result.signal, error: result.error ? { code: result.error.code, message: result.error.message } : null };
writeFileSync(join(report, `${label}-${attempt}.json`), `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(record)}\n`);
process.exit(result.status ?? 1);
