import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const baseline = "ba292a059184a36e4bb6c3341ac059606d24f961";
const output = process.argv[2];
if (!output) throw new Error("Explicit output path required");
function hashes(path) {
  const bytes = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
  return { path, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    gitBlob: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") };
}
const tree = execFileSync("git", ["ls-tree", "-r", "-z", baseline, "--", "tests", "docs/test-reports"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const preserved = tree.split("\0").filter(Boolean).map((line) => {
  const [header, path] = line.split("\t");
  const expectedBlob = header.split(" ")[2];
  const current = hashes(path);
  return { ...current, expectedBlob, unchanged: current.gitBlob === expectedBlob };
});
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const sourceAndTests = [
  "src/cli/agent-version.ts", "src/cli/bounded-subprocess.ts", "src/cli/bounded-subprocess-worker.mjs", "src/cli/git.ts", "src/cli/replay.ts",
  ...files("tests/cli/process-bounds"), ...files("tests/fixtures/process-bounds")
].sort().map(hashes);
const summary = { baseline, candidateProductHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  preservedCount: preserved.length, altered: preserved.filter((item) => !item.unchanged).map((item) => item.path),
  sourceAndTests, preserved };
writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ baseline, candidateProductHead: summary.candidateProductHead,
  preservedCount: preserved.length, altered: summary.altered, sourceAndTestCount: sourceAndTests.length }));
if (summary.altered.length) process.exitCode = 1;
