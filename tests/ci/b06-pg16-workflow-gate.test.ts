import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
const verifyDb = workflow.slice(
  workflow.indexOf("  verify-db:"),
  workflow.indexOf("  verify-browser:")
);

describe("B06 native PostgreSQL 16 workflow gate", () => {
  it("runs the dedicated B06 probe with the matching scratch URL in UTC", () => {
    expect(verifyDb).toContain("TZ: UTC");
    expect(verifyDb).toContain("POSTGRES_DB: tokenizer_ci_scratch");
    expect(verifyDb).toContain('pg_isready -U tokenizer_ci -d tokenizer_ci_scratch');
    expect(verifyDb).toContain(
      "DATABASE_URL: postgresql://tokenizer_ci:tokenizer_ci@localhost:5432/tokenizer_ci_scratch"
    );
    expect(verifyDb).toContain(
      "EVAL_B06_DB_URL: postgresql://tokenizer_ci:tokenizer_ci@localhost:5432/tokenizer_ci_scratch"
    );
    expect(verifyDb.match(/tests\/server\/b06-batch-db\.probe\.test\.ts/g)).toHaveLength(1);
    expect(verifyDb.match(/tests\/server\/b06-partial-ack-db\.probe\.test\.ts/g)).toHaveLength(1);
  });

  it("retains the historical probes and includes all four B06 PG cases in the no-skip floor", () => {
    for (const path of [
      "tests/server/quota-account-db.probe.test.ts",
      "tests/server/harness-gates-route-db.probe.test.ts",
      "tests/server/harness-cost-range-db.probe.test.ts",
      "tests/evaluator/bl-cost-batch-v1-f003-cachekey-db.probe.test.ts",
      "tests/evaluator/bl-security-p1-f008-probes.test.ts"
    ]) {
      expect(verifyDb).toContain(path);
    }
    expect(verifyDb).toContain(
      "node scripts/ci/assert-vitest-results.mjs .ci/db-probes.json 14"
    );
  });
});
