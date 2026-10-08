import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const report = dirname(fileURLToPath(import.meta.url));
const baseline = "c8e63c52302f9fa5b7756985400705faa8209be4";
const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const allowed = (path) => ["src/cli/privacy.ts", "tests/ci/vps-host-preflight.test.ts", "progress.json", "features.json"].includes(path);
const inventory = git("ls-tree", "-r", "-z", baseline).split("\0").filter(Boolean).map((line) => {
  const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(line);
  if (!match) throw new Error(`unsupported tracked entry: ${line}`);
  const [, baseMode, baseBlob, path] = match;
  const stat = lstatSync(path);
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
  const mode = stat.isSymbolicLink() ? "120000" : (stat.mode & 0o111 ? "100755" : "100644");
  const currentBlob = blob(bytes);
  return { path, baseMode, baseBlob, mode, currentBlob, sha256: sha256(bytes), bytes: bytes.length,
    changed: mode !== baseMode || currentBlob !== baseBlob, allowed: allowed(path) };
});
const changes = inventory.filter((entry) => entry.changed);
const frozenChanges = changes.filter((entry) => !entry.allowed);
const newTracked = git("diff", "--name-only", "--diff-filter=A", baseline, "HEAD").trim().split("\n").filter(Boolean);
const expectExpressions = (text) => {
  const source = ts.createSourceFile("fixture.ts", text, ts.ScriptTarget.Latest, true);
  const expressions = [];
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "expect") {
      let assertion = node;
      while (assertion.parent && (ts.isPropertyAccessExpression(assertion.parent) || ts.isCallExpression(assertion.parent))) {
        assertion = assertion.parent;
      }
      expressions.push(assertion.getText(source));
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return expressions;
};
const fixture = "tests/ci/vps-host-preflight.test.ts";
const originalAssertions = expectExpressions(git("show", `${baseline}:${fixture}`));
const currentAssertions = expectExpressions(readFileSync(fixture, "utf8"));
const assertions = { originalCount: originalAssertions.length, currentCount: currentAssertions.length,
  originalSha256: sha256(JSON.stringify(originalAssertions)), currentSha256: sha256(JSON.stringify(currentAssertions)),
  identical: JSON.stringify(originalAssertions) === JSON.stringify(currentAssertions) };
writeFileSync(join(report, "baseline-tracked-inventory.json"), `${JSON.stringify({ baseline, inspectedHead: git("rev-parse", "HEAD").trim(), inventory }, null, 2)}\n`);
writeFileSync(join(report, "source-boundary.json"), `${JSON.stringify({ baseline, inspectedHead: git("rev-parse", "HEAD").trim(),
  originalTrackedCount: inventory.length, changes, frozenChanges, newTracked, assertions,
  check: "byte/mode inventory only, not functional or release acceptance" }, null, 2)}\n`);

const native = "/Volumes/ORICO/project/.worktrees/tokenizer-windows-native-diagnostic-ci-20261008/docs/test-reports/windows-native-ci-20261008/run-37808814119-original";
const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const nativeFiles = files(native).sort().map((path) => {
  const bytes = readFileSync(path);
  return { path: relative(native, path), bytes: bytes.length, sha256: sha256(bytes) };
});
writeFileSync(join(report, "original-native-evidence-hashes.json"), `${JSON.stringify({ root: native, run: 37808814119,
  diagnosticOnly: true, releaseAcceptance: false, files: nativeFiles }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ originalTrackedCount: inventory.length, allowedChanges: changes.length,
  frozenChanges, assertions, originalNativeFiles: nativeFiles.length })}\n`);
if (frozenChanges.length || !assertions.identical) process.exit(1);
