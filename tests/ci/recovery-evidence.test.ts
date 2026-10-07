import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sha = "a".repeat(40);
const dump = `${sha}.tokenizer-rehearsal-123-456.backup.dump`;
const script = resolve("scripts/ci/recovery-evidence.mjs");
let root: string;
let source: string;
let staged: string;
let downloaded: string;
function invoke(operation = "stage", directory = source, revision = sha, provenance = "false") {
  return spawnSync(process.execPath, [script, operation, directory, revision, provenance, ...(operation === "stage" ? [staged] : [])], { encoding: "utf8" });
}
function roundTrip(provenance = "false") {
  expect(invoke("stage", source, sha, provenance).status).toBe(0);
  cpSync(staged, downloaded, { recursive: true });
  return invoke("verify", downloaded, sha, provenance);
}
function alterManifest(change: (manifest: { entries: Array<{ file: string }>; revision: string }) => void) {
  const path = join(downloaded, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

describe("allowlisted recovery evidence transport", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "recovery-evidence-"));
    source = join(root, ".releases");
    staged = join(root, "staged");
    downloaded = join(root, "downloaded");
    mkdirSync(source);
    const contents = Buffer.from("synthetic isolated canary dump\n");
    writeFileSync(join(source, dump), contents);
    writeFileSync(join(source, `${dump}.sha256`), `${createHash("sha256").update(contents).digest("hex")}  .releases/${dump}\n`);
    writeFileSync(join(source, `${sha}.rehearsal`), `commit=${sha}\nmode=synthetic\nbackup_file=.releases/${dump}\nrestore_inventory=1|1|1|1|23\nruntime_uid=1000\nrollback=passed\nelapsed_seconds=1\n`);
    writeFileSync(join(source, `${sha}.rollback-approved`), `app_image=localhost:5000/app@sha256:${"b".repeat(64)}\nprevious_sha=${"c".repeat(40)}\n`);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("retains only expected exact-SHA synthetic files and verifies a downloaded copy", () => {
    for (const name of [".env", `${sha}.previous-env`, "production.backup.dump", `${"d".repeat(40)}.rehearsal`]) {
      writeFileSync(join(source, name), "secret-canary-do-not-upload");
    }
    expect(roundTrip().status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(downloaded, "manifest.json"), "utf8"));
    expect(manifest.entries).toHaveLength(4);
    expect(manifest.provenanceRequired).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("previous-env");
    expect(existsSync(join(staged, ".env"))).toBe(false);
    expect(existsSync(join(staged, "production.backup.dump"))).toBe(false);
  });
  it.each([dump, `${dump}.sha256`, `${sha}.rehearsal`, `${sha}.rollback-approved`])("fails closed before staging when %s is missing", (file) => {
    rmSync(join(source, file));
    const result = invoke();
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("recovery evidence validation failed");
    expect(existsSync(staged)).toBe(false);
  });
  it.each(["live", "unavailable"])("rejects non-synthetic or unapproved evidence (%s)", (value) => {
    const ledger = join(source, `${sha}.rehearsal`);
    writeFileSync(ledger, readFileSync(ledger, "utf8").replace(value === "live" ? "mode=synthetic" : "rollback=passed", value === "live" ? "mode=live" : "rollback=unavailable"));
    expect(invoke().status).toBe(1);
  });
  it("rejects an ambiguous second same-SHA dump and an incorrect backup checksum", () => {
    writeFileSync(join(source, dump.replace("123-456", "789-123")), "other dump");
    expect(invoke().status).toBe(1);
    rmSync(join(source, dump.replace("123-456", "789-123")));
    writeFileSync(join(source, `${dump}.sha256`), `${"0".repeat(64)}  .releases/${dump}\n`);
    expect(invoke().status).toBe(1);
  });
  it("detects downloaded file tampering, missing files, extra files and wrong revision", () => {
    expect(roundTrip().status).toBe(0);
    expect(invoke("verify", downloaded, "d".repeat(40)).status).toBe(1);
    writeFileSync(join(downloaded, dump), "tampered dump");
    expect(invoke("verify", downloaded).status).toBe(1);
    cpSync(join(staged, dump), join(downloaded, dump));
    writeFileSync(join(downloaded, ".env"), "secret-canary");
    expect(invoke("verify", downloaded).status).toBe(1);
    rmSync(join(downloaded, ".env"));
    rmSync(join(downloaded, `${sha}.rollback-approved`));
    expect(invoke("verify", downloaded).status).toBe(1);
  });
  it("rejects manifest traversal paths and forged manifest hashes", () => {
    expect(roundTrip().status).toBe(0);
    alterManifest((manifest) => { manifest.entries[0].file = "../.env"; });
    expect(invoke("verify", downloaded).status).toBe(1);
    cpSync(join(staged, "manifest.json"), join(downloaded, "manifest.json"));
    const path = join(downloaded, "manifest.json");
    writeFileSync(path, readFileSync(path, "utf8").replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${"0".repeat(64)}"`));
    expect(invoke("verify", downloaded).status).toBe(1);
  });
  it.skipIf(process.platform === "win32")("rejects symlink files and symlink directories", () => {
    const original = join(root, "outside.dump");
    cpSync(join(source, dump), original);
    rmSync(join(source, dump));
    symlinkSync(original, join(source, dump));
    expect(invoke().status).toBe(1);
    rmSync(join(source, dump));
    cpSync(original, join(source, dump));
    expect(roundTrip().status).toBe(0);
    const link = join(root, "linked-evidence");
    symlinkSync(downloaded, link);
    expect(invoke("verify", link).status).toBe(1);
    rmSync(join(downloaded, dump));
    symlinkSync(original, join(downloaded, dump));
    expect(invoke("verify", downloaded).status).toBe(1);
  });
  it("requires main provenance files separately and forbids main/non-main manifest downgrade", () => {
    expect(invoke("stage", source, sha, "true").status).toBe(1);
    for (const kind of ["app", "migrate"]) {
      writeFileSync(join(source, `${sha}.${kind}.provenance.json`), '[{"verification":"synthetic-test-only"}]\n');
      writeFileSync(join(source, `${sha}.${kind}.provenance-negative-controls`), "wrong_source=rejected\nwrong_workflow=rejected\n");
    }
    expect(roundTrip("true").status).toBe(0);
    expect(JSON.parse(readFileSync(join(downloaded, "manifest.json"), "utf8")).entries).toHaveLength(8);
    expect(invoke("verify", downloaded, sha, "false").status).toBe(1);
  });
  it("requires actual artifact upload/download in the same job with fail-closed options", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    const releaseJob = workflow.slice(workflow.indexOf("  release-artifact:"), workflow.indexOf("  deploy:"));
    expect(releaseJob).toContain("REHEARSAL_MODE: synthetic");
    expect(releaseJob).toContain("node scripts/ci/recovery-evidence.mjs stage .releases");
    const upload = releaseJob.slice(releaseJob.indexOf("- name: Retain synthetic recovery evidence"), releaseJob.indexOf("- name: Download retained synthetic recovery evidence"));
    expect(upload).toContain("uses: actions/upload-artifact@v4");
    expect(upload).toContain("path: release-recovery-evidence/");
    expect(upload).toContain("include-hidden-files: true");
    expect(upload).toContain("if-no-files-found: error");
    expect(upload).not.toContain("path: .releases/");
    expect(releaseJob).toContain("uses: actions/download-artifact@v4");
    expect(releaseJob.match(/name: release-recovery-\$\{\{ github.sha \}\}/g)).toHaveLength(2);
    expect(releaseJob).toContain("node scripts/ci/recovery-evidence.mjs verify release-recovery-downloaded");
    expect(releaseJob.indexOf("actions/download-artifact@v4")).toBeGreaterThan(releaseJob.indexOf("actions/upload-artifact@v4"));
  });
  it("keeps the deployment overview consistent with immutable CI artifacts", () => {
    const doc = readFileSync("docs/VPS-deployment.md", "utf8");
    const overview = doc.slice(doc.indexOf("## 5. GitHub CI/CD Deployment"), doc.indexOf("### Required GitHub Secrets"));
    expect(overview).toContain("builds Linux app and migration OCI artifacts once in CI");
    expect(overview).toContain("It does not rebuild app images on the VPS");
    expect(overview).not.toContain("does not yet build the deployment image in CI");
    expect(overview).not.toContain("builds SHA-tagged images on the VPS");
    expect(doc).toContain("not images rebuilt on the VPS");
  });
});
