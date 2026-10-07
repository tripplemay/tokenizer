import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const baseline = "3ade5d1e45ac0f53f0f7a122711e6e219b7dac09";
const supplement = "11907f5df1bcedc03a5600252056502fd1e88f3f";

function gitShow(revision: string, path: string) {
  return execFileSync("git", ["show", `${revision}:${path}`], { cwd: repo, encoding: "utf8" });
}

describe("B05 independent TCP readiness audit", () => {
  it("changes only the readiness transport in the recovery script", () => {
    const path = "scripts/test/rehearse-release.sh";
    const before = gitShow(baseline, path);
    const after = readFileSync(path, "utf8");
    expect(before).toContain('docker exec "$1" pg_isready -U tokenizer -d tokenizer');
    expect(after).toContain('docker exec "$1" pg_isready -h 127.0.0.1 -U tokenizer -d tokenizer');

    const normalized = after
      .replace("    # First-init uses a socket-only temporary server that will shut down.\n", "")
      .replace("    # TCP readiness accepts only the final server, before migration/restore.\n", "")
      .replace("pg_isready -h 127.0.0.1 -U", "pg_isready -U");
    expect(normalized).toBe(before);
  });

  it("retains backup, cleanup, and rollback approval ordering byte-for-byte", () => {
    const path = "scripts/test/rehearse-release.sh";
    const before = gitShow(baseline, path);
    const after = readFileSync(path, "utf8");
    const invariants = [
      'gate=".releases/$expected.rollback-approved"\nrm -f "$gate"',
      'dump=".releases/$expected.$prefix.backup.dump"',
      'rm -f "$temp_dump"',
      '[[ -s "$temp_dump" ]] || { echo "empty PostgreSQL backup" >&2; exit 1; }',
      'mv "$temp_dump" "$dump"',
      'sha256sum "$dump" > "$dump.sha256"',
      'docker exec -i "$db" pg_restore -U tokenizer -d tokenizer --exit-on-error --no-owner < "$dump"',
      "  canary \"$db\"\n  [[ \"$(inventory \"$db\")\" == \"$restored_inventory\" ]] || { echo \"rollback canary cleanup changed inventory\" >&2; exit 1; }\n  printf 'app_image=%s\\nprevious_sha=%s\\n' \"$previous_app\" \"$previous_sha\" > \"$gate\""
    ];
    for (const invariant of invariants) {
      expect(before).toContain(invariant);
      expect(after).toContain(invariant);
    }
  });

  it("preserves the immutable post-CI supplement while exposing the remaining VPS-doc contradiction", () => {
    const supplementPath = "docs/test-reports/M1-B05-R13-round3-post-ci-evaluator-supplement.json";
    expect(readFileSync(supplementPath, "utf8")).toBe(gitShow(supplement, supplementPath));

    const docs = readFileSync("docs/VPS-deployment.md", "utf8");
    expect(docs).toContain("builds Linux app and migration OCI artifacts in CI");
    expect(docs).toContain("does not yet build the deployment image in CI");
    expect(docs).toContain("builds SHA-tagged images on the VPS");
  });
});
