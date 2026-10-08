import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const candidate = "f754423387374afee0671f951730cac43bad7891";
const baseline = "76d916ba2e3a7147acda5ac9ef15fa70a9cd9958";
const originalRoot = "/Volumes/ORICO/project/.worktrees/tokenizer-windows-native-repair-20261008";
const reportRoot = "docs/test-reports/windows-queue-failure-findings-r1";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args);
const paths = [
  "tests/cli/b07-prereview-process.test.ts", "tests/fixtures/b07-prereview-worker.ts",
  "src/cli/queue.ts", "src/cli/atomic-file.ts", "src/cli/config.ts",
  "src/cli/queue-event-version.ts", "src/cli/file-permissions.ts",
  "src/cli/rejected-events.ts", "src/cli/privacy.ts",
  "src/shared/usage-privacy.ts", "src/shared/git-remote.ts",
  "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts",
  ".github/workflows/deploy-vps.yml"
];
const sources = paths.map((path) => {
  const blob = git("show", `${candidate}:${path}`);
  const oldBlob = git("show", `${baseline}:${path}`);
  const localBytesMatchCandidate = blob.equals(readFileSync(path));
  assert.equal(localBytesMatchCandidate, true, `${path} differs from candidate`);
  return {
    path,
    sha256: hash(blob),
    candidateBlob: git("rev-parse", `${candidate}:${path}`).toString().trim(),
    baselineBlob: git("rev-parse", `${baseline}:${path}`).toString().trim(),
    unchangedFromBaseline: blob.equals(oldBlob),
    localBytesMatchCandidate
  };
});
const evidenceSpec = [
  ["docs/test-reports/BL-WINDOWS-NATIVE-REPAIR-coordination-20261009/repair-ci-37813254244-windows-job-original.log", "repair-ci-37813254244-windows-job-original.log"],
  ["docs/test-reports/BL-WINDOWS-NATIVE-REPAIR-coordination-20261009/repair-ci-37813254244-completed-original.json", "repair-ci-37813254244-completed-original.json"],
  ["docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/ci-37803611472-windows-full-job.log", "baseline-ci-37803611472-windows-full-job.log"],
  ["docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/ci-37803611472-windows-original.log", null],
  ["docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/ci-37803611472-run.json", null],
  ["docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/native-ci-failure.md", null]
];
const evidence = evidenceSpec.map(([originalRelativePath, copyName]) => {
  const originalPath = join(originalRoot, originalRelativePath);
  const bytes = readFileSync(originalPath);
  const copyPath = copyName ? join(reportRoot, copyName) : null;
  const copyBytesEqual = copyPath ? bytes.equals(readFileSync(copyPath)) : null;
  if (copyPath) assert.equal(copyBytesEqual, true, `${copyPath} is not an exact copy`);
  return { originalPath, copyPath, byteLength: bytes.length, sha256: hash(bytes), copyBytesEqual };
});
const localProbe = ["local-exit-information-loss.mjs", "local-exit-information-loss-output.json"].map((name) => ({
  path: join(reportRoot, name),
  sha256: hash(readFileSync(join(reportRoot, name)))
}));
console.log(JSON.stringify({
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  candidate,
  baseline,
  sourceHashScope: "Canonical git blob bytes at candidate; not a claim about unrecorded Windows checkout CRLF bytes",
  reportWorktree: process.cwd(),
  sources,
  evidence,
  localProbe,
  changedPathsBetweenRuns: git("diff", "--name-only", baseline, candidate, "--", "src", "tests", "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", ".github/workflows/deploy-vps.yml").toString().trim().split("\n")
}, null, 2));
