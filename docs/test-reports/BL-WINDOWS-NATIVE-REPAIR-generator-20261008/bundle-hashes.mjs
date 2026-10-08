import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const report = dirname(fileURLToPath(import.meta.url));
const output = join(report, "handoff-hashes.json");
const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const source = ["src/cli/privacy.ts", "src/cli/bounded-subprocess-worker.mjs", "src/cli/bounded-subprocess.ts",
  "tests/ci/vps-host-preflight.test.ts", "tests/ci/windows-native-repair-workflow.test.ts",
  "tests/cli/windows-native-repair/privacy-ancestor.test.ts", "features.json", "progress.json"];
const entries = [...source, ...files(report).filter((path) => path !== output)].sort().map((path) => {
  const bytes = readFileSync(path);
  return { path: relative(process.cwd(), path.startsWith("/") ? path : join(process.cwd(), path)),
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
writeFileSync(output, `${JSON.stringify({ schema: 1, excludes: [relative(process.cwd(), output)], files: entries }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ files: entries.length, sha256: createHash("sha256").update(readFileSync(output)).digest("hex") })}\n`);
