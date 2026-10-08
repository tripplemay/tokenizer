import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = "docs/test-reports/windows-queue-failure-findings-r1";
const json = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const verdict = json("verdict.json");
const provenance = json("provenance.json");
const local = json("local-exit-information-loss-output.json");
assert.equal(verdict.candidate_sha, provenance.candidate);
assert.equal(verdict.run_id, 37813254244);
assert.equal(verdict.job_id, 113518921402);
assert.equal(verdict.repair_assessed, false);
assert.equal(verdict.windows_reproduction_performed, false);
for (const source of provenance.sources) {
  const blob = execFileSync("git", ["show", `${provenance.candidate}:${source.path}`]);
  assert.equal(hash(blob), source.sha256, source.path);
  assert.ok(blob.equals(readFileSync(source.path)), `${source.path} was modified`);
}
for (const item of provenance.evidence) {
  const original = readFileSync(item.originalPath);
  assert.equal(hash(original), item.sha256, item.originalPath);
  if (item.copyPath) assert.ok(original.equals(readFileSync(item.copyPath)), item.copyPath);
}
for (const item of provenance.localProbe) assert.equal(hash(readFileSync(item.path)), item.sha256);
const raw = readFileSync(join(root, "repair-ci-37813254244-windows-job-original.log"), "utf8");
const lines = raw.split(/\r?\n/);
assert.ok(lines[93].includes(provenance.candidate));
assert.ok(lines[700].includes("b07-prereview-process.test.ts:29:167"));
assert.ok(lines[703].includes("message: ''"));
assert.ok(lines[835].includes("Process completed with exit code 1"));
assert.equal(raw.includes("MULTIPROCESS_CONTROL"), false);
const baselineLines = readFileSync(join(root, "baseline-ci-37803611472-windows-full-job.log"), "utf8").split(/\r?\n/);
assert.ok(baselineLines[597].includes('MULTIPROCESS_CONTROL {"beforeCount":8,"afterAckCount":7}'));
assert.ok(baselineLines[601].includes("eight simultaneous native writers"));
const metadata = json("repair-ci-37813254244-completed-original.json");
assert.equal(metadata.headSha, provenance.candidate);
assert.ok(metadata.url.endsWith(`/runs/${verdict.run_id}`));
const windows = metadata.jobs.find((job) => job.databaseId === verdict.job_id);
assert.equal(windows.name, "Verify (Windows)");
assert.equal(windows.steps.find((step) => step.name === "Run unit tests").conclusion, "failure");
assert.equal(local.scope, "LOCAL_MACOS_ERROR_PROJECTION_ONLY_NOT_WINDOWS_OR_QUEUE_REPRODUCTION");
assert.equal(local.platform, "darwin");
assert.equal(local.observations[0].exit.code, 17);
assert.equal(local.observations[1].exit.code, null);
assert.equal(local.observations[1].exit.signal, "SIGTERM");
for (const row of local.observations) assert.equal(row.exit.projectedErrorMessage, "");
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
for (const entry of status) assert.ok(entry.slice(3).startsWith(`${root}/`), `Outside report scope: ${entry}`);
console.log(JSON.stringify({
  scope: "REPORT_SOURCE_AND_LOG_INTEGRITY_ONLY_NOT_WINDOWS_ACCEPTANCE",
  outcome: "PASS",
  sourceCount: provenance.sources.length,
  originalEvidenceCount: provenance.evidence.length,
  exactEvidenceCopyCount: provenance.evidence.filter((item) => item.copyPath).length,
  decisiveLineReferencesChecked: true,
  candidateRunJobBindingChecked: true,
  onlyReportDirectoryInGitStatus: true,
  oldProductTestsUnmodified: true
}, null, 2));
