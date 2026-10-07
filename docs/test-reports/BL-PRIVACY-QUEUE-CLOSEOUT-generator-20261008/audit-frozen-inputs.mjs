import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024 });
const baseline = "f8449e8";
const inputs = new Map();
const preserved = git("ls-tree", "-r", "--name-only", baseline, "docs/test-reports").toString().trim().split("\n");
for (const path of [...preserved, "tests/cli/agent-sync-checkpoint.test.ts", "tests/evaluator/bl-homepage-freshness-f002-f003.test.ts"]) {
  inputs.set(path, baseline);
}
for (const ref of ["3220837", "7da2452"]) {
  for (const path of git("diff-tree", "--no-commit-id", "--name-only", "-r", ref).toString().trim().split("\n")) {
    inputs.set(path, ref);
  }
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const records = [];
for (const [path, ref] of inputs) {
  const expected = git("show", `${ref}:${path}`);
  const actual = readFileSync(path);
  if (!expected.equals(actual)) throw new Error(`Frozen input differs: ${ref}:${path}`);
  records.push({ path, from: ref, sha256: sha256(expected), bytes: expected.length });
}
console.log(JSON.stringify({ baseline, records }, null, 2));
