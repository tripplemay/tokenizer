import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const historicalManifest = "docs/test-reports/B05-tcp-readiness-independent-20261007/evidence/SHA256SUMS";
const historicalTest = "tests/evaluator/b05-tcp-readiness-independent.test.ts";
const roots: string[] = [];
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("B05 retained recovery evidence round 2", () => {
  it("keeps all nine immutable historical evidence entries byte-identical", () => {
    const entries = readFileSync(historicalManifest, "utf8").trim().split("\n").map((line) => {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      expect(match).not.toBeNull();
      return { digest: match![1], path: match![2] };
    });
    expect(entries).toHaveLength(9);
    for (const entry of entries) {
      const stat = lstatSync(entry.path);
      expect(stat.isFile()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      expect(sha256(readFileSync(entry.path))).toBe(entry.digest);
    }
    expect(sha256(readFileSync(historicalTest))).toBe("cd29a182483084db6135c97f8c0a6644758a4e86c6a37d7d776243f8c81d5ba0");
  });

  it("archives only the obsolete local-object test and retains an active portable replacement", () => {
    const config = readFileSync("vitest.config.ts", "utf8");
    expect(config).toContain(`exclude: [...configDefaults.exclude, "${historicalTest}"]`);
    expect(config).not.toMatch(/exclude:[^\n]+tests\/evaluator\/\*\*/);
    const replacement = readFileSync("tests/ci/b05-recovery-source.test.ts", "utf8");
    const helper = readFileSync("tests/helpers/b05-source-invariants.ts", "utf8");
    expect(replacement).toContain("preserves the exact readiness-only source delta");
    expect(replacement).toContain("rejects a %s mutation");
    expect(helper).not.toMatch(/git show|execFile|spawnSync/);
  });

  it("orders allowlist staging, fail-closed upload, download, and downloaded hash verification", () => {
    const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
    const job = workflow.slice(workflow.indexOf("  release-artifact:"), workflow.indexOf("  deploy:"));
    const ordered = [
      "Stage allowlisted synthetic recovery evidence",
      "Retain synthetic recovery evidence",
      "Download retained synthetic recovery evidence",
      "Verify downloaded recovery evidence manifest and hashes"
    ].map((name) => job.indexOf(name));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(job).toContain("if-no-files-found: error");
    expect(job).toContain("include-hidden-files: true");
    expect(job).toContain("path: release-recovery-evidence/");
    expect(job).not.toContain("path: .releases/");
    expect(job).toContain("REQUIRE_PROVENANCE: ${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' }}");
  });

  it("round-trips only four non-main allowlisted files and rejects downloaded tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "b05-round2-evaluator-"));
    roots.push(root);
    const source = join(root, ".releases");
    const staged = join(root, "staged");
    const downloaded = join(root, "downloaded");
    const revision = "a".repeat(40);
    const dump = `${revision}.tokenizer-rehearsal-10-20.backup.dump`;
    const dumpBytes = Buffer.from("bounded synthetic dump\n");
    mkdirSync(source);
    writeFileSync(join(source, dump), dumpBytes);
    writeFileSync(join(source, `${dump}.sha256`), `${sha256(dumpBytes)}  .releases/${dump}\n`);
    writeFileSync(join(source, `${revision}.rehearsal`), [
      `commit=${revision}`,
      "mode=synthetic",
      `backup_file=.releases/${dump}`,
      "restore_inventory=1|1|1|1|1",
      "runtime_uid=1000",
      "rollback=passed"
    ].join("\n") + "\n");
    writeFileSync(join(source, `${revision}.rollback-approved`),
      `app_image=localhost:5000/app@sha256:${"b".repeat(64)}\nprevious_sha=${"c".repeat(40)}\n`);
    writeFileSync(join(source, ".env"), "SECRET_CANARY");
    const script = resolve("scripts/ci/recovery-evidence.mjs");

    expect(spawnSync(process.execPath, [script, "stage", source, revision, "false", staged]).status).toBe(0);
    cpSync(staged, downloaded, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(downloaded, "manifest.json"), "utf8"));
    expect(manifest.entries).toHaveLength(4);
    expect(existsSync(join(downloaded, ".env"))).toBe(false);
    expect(spawnSync(process.execPath, [script, "verify", downloaded, revision, "false"]).status).toBe(0);
    writeFileSync(join(downloaded, dump), "tampered");
    expect(spawnSync(process.execPath, [script, "verify", downloaded, revision, "false"]).status).toBe(1);
  });
});
