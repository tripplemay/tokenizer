import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [operation, directory, revision, provenance, output] = process.argv.slice(2);
const manifestName = "manifest.json";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function requireCondition(condition) {
  if (!condition) throw new Error("invalid recovery evidence");
}
function directoryEntries(path) {
  const stat = lstatSync(path);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink());
  return readdirSync(path).sort();
}
function readFile(path, maximum = 1024 * 1024) {
  const stat = lstatSync(path);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum);
  return readFileSync(path);
}
function expectedFiles(names) {
  const dumpPattern = new RegExp(`^${revision}\\.tokenizer-rehearsal-[0-9]+-[0-9]+\\.backup\\.dump$`);
  const dumps = names.filter((name) => dumpPattern.test(name));
  requireCondition(dumps.length === 1);
  const files = [dumps[0], `${dumps[0]}.sha256`, `${revision}.rehearsal`, `${revision}.rollback-approved`];
  if (provenance === "true") {
    for (const kind of ["app", "migrate"]) {
      files.push(`${revision}.${kind}.provenance.json`, `${revision}.${kind}.provenance-negative-controls`);
    }
  }
  return files.sort();
}
function readEvidence(path, files) {
  const contents = new Map(files.map((file) => [file, readFile(join(path, file), file.endsWith(".dump") ? 64 * 1024 * 1024 : undefined)]));
  const dump = files.find((file) => file.endsWith(".dump"));
  requireCondition(contents.get(`${dump}.sha256`).toString("utf8").trim() === `${hash(contents.get(dump))}  .releases/${dump}`);
  const ledger = contents.get(`${revision}.rehearsal`).toString("utf8").trim().split(/\r?\n/);
  requireCondition(ledger.includes(`commit=${revision}`) && ledger.includes("mode=synthetic") &&
    ledger.includes(`backup_file=.releases/${dump}`) && ledger.includes("rollback=passed"));
  requireCondition(ledger.some((line) => /^restore_inventory=[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+$/.test(line)));
  requireCondition(ledger.some((line) => /^runtime_uid=[1-9][0-9]*$/.test(line)));
  const approval = contents.get(`${revision}.rollback-approved`).toString("utf8").trim().split(/\r?\n/);
  requireCondition(approval.length === 2 && /^app_image=[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}$/.test(approval[0]) &&
    /^previous_sha=[0-9a-f]{40}$/.test(approval[1]));
  if (provenance === "true") {
    for (const kind of ["app", "migrate"]) {
      JSON.parse(contents.get(`${revision}.${kind}.provenance.json`).toString("utf8"));
      requireCondition(contents.get(`${revision}.${kind}.provenance-negative-controls`).toString("utf8").trim() ===
        "wrong_source=rejected\nwrong_workflow=rejected");
    }
  }
  return contents;
}

try {
  requireCondition(/^[0-9a-f]{40}$/.test(revision ?? "") && ["true", "false"].includes(provenance));
  requireCondition((operation === "stage" && process.argv.length === 7) || (operation === "verify" && process.argv.length === 6));
  const names = directoryEntries(directory);
  if (operation === "stage") {
    const files = expectedFiles(names);
    const contents = readEvidence(directory, files);
    // Only exact-SHA synthetic evidence is copied; unrelated .env, live
    // backups, previous-env files, and unknown .releases entries stay out.
    mkdirSync(output, { mode: 0o700 });
    const entries = files.map((file) => {
      const bytes = contents.get(file);
      writeFileSync(join(output, file), bytes, { mode: 0o600, flag: "wx" });
      return { file, bytes: bytes.length, sha256: hash(bytes) };
    });
    writeFileSync(join(output, manifestName), JSON.stringify({ schema: 1, revision, provenanceRequired: provenance === "true", entries }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } else {
    const manifest = JSON.parse(readFile(join(directory, manifestName)).toString("utf8"));
    requireCondition(Object.keys(manifest).sort().join(",") === "entries,provenanceRequired,revision,schema");
    requireCondition(manifest.schema === 1 && manifest.revision === revision && manifest.provenanceRequired === (provenance === "true") && Array.isArray(manifest.entries));
    const files = expectedFiles(names);
    requireCondition(names.join("\n") === [...files, manifestName].sort().join("\n") && manifest.entries.length === files.length);
    const contents = readEvidence(directory, files);
    for (const [index, file] of files.entries()) {
      const entry = manifest.entries[index];
      requireCondition(entry && Object.keys(entry).sort().join(",") === "bytes,file,sha256" && entry.file === file);
      requireCondition(entry.bytes === contents.get(file).length && entry.sha256 === hash(contents.get(file)));
    }
  }
  console.log(JSON.stringify({ recoveryEvidence: operation, revision, provenanceRequired: provenance === "true" }));
} catch {
  console.error("recovery evidence validation failed");
  process.exitCode = 1;
}
