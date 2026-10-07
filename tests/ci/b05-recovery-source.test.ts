import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchesDeploymentDocs, matchesPostCiSupplement, matchesRecoverySource, RECOVERY_INVARIANTS } from "../helpers/b05-source-invariants";

const script = readFileSync("scripts/test/rehearse-release.sh", "utf8");
const supplement = readFileSync("docs/test-reports/M1-B05-R13-round3-post-ci-evaluator-supplement.json", "utf8");
const docs = readFileSync("docs/VPS-deployment.md", "utf8");
const historical = "tests/evaluator/b05-tcp-readiness-independent.test.ts";

describe("portable B05 recovery source and evidence invariants", () => {
  it.each(["LF", "CRLF"])("preserves the exact readiness-only source delta and immutable supplement with %s checkout", (ending) => {
    const checkout = (text: string) => ending === "CRLF" ? text.replace(/\r?\n/g, "\r\n") : text.replace(/\r\n/g, "\n");
    expect(matchesRecoverySource(checkout(script))).toBe(true);
    expect(matchesPostCiSupplement(checkout(supplement))).toBe(true);
    expect(matchesDeploymentDocs(checkout(docs))).toBe(true);
    for (const invariant of RECOVERY_INVARIANTS) expect(script.replace(/\r\n/g, "\n")).toContain(invariant);
  });
  it.each([
    ["temporary socket readiness", "pg_isready -h 127.0.0.1 -U", "pg_isready -U"],
    ["stale approval removal", 'rm -f "$gate"', ":"],
    ["backup checksum gate", 'sha256sum -c "$dump.sha256"', "true"],
    ["restore fail-closed", "--exit-on-error", ""],
    ["rollback ledger", "rollback=passed", "rollback=unavailable"],
    ["backup cleanup", 'rm -f "$temp_dump"', ":"]
  ])("rejects a %s mutation", (_name, before, after) => {
    expect(script).toContain(before);
    expect(matchesRecoverySource(script.replace(before, after))).toBe(false);
  });
  it("rejects changed supplement evidence and reintroduced deployment-doc drift", () => {
    expect(matchesPostCiSupplement(`${supplement} `)).toBe(false);
    expect(matchesPostCiSupplement(supplement.replace('"CI_BLOCKED"', '"PASS"'))).toBe(false);
    expect(matchesDeploymentDocs(`${docs}\ndoes not yet build the deployment image in CI\n`)).toBe(false);
    expect(matchesDeploymentDocs(`${docs}\nbuilds SHA-tagged images on the VPS\n`)).toBe(false);
  });
  it("excludes only the immutable historical local-object audit, with an active portable replacement", () => {
    const config = readFileSync("vitest.config.ts", "utf8");
    expect(config).toContain(`exclude: [...configDefaults.exclude, "${historical}"]`);
    expect(config).not.toContain('"tests/evaluator/**"');
    const original = readFileSync(historical, "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(original).digest("hex")).toBe("cd29a182483084db6135c97f8c0a6644758a4e86c6a37d7d776243f8c81d5ba0");
    const replacement = readFileSync("tests/ci/b05-recovery-source.test.ts", "utf8");
    const helper = readFileSync("tests/helpers/b05-source-invariants.ts", "utf8");
    expect(replacement).toContain("matchesRecoverySource");
    expect(helper).not.toMatch(/execFile|spawnSync|gitShow|git show/);
  });
});
