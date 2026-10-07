import { configDefaults } from "vitest/config";
import { expect, it } from "vitest";
import config from "../../vitest.config";

it("retains the exact baseline execution scope except the two documented B06 replacements", () => {
  const baselineProjectExclusions = [
    "tests/evaluator/b05-tcp-readiness-independent.test.ts",
    "tests/evaluator/b03-scope-admission-independent.test.ts",
    "tests/cli/b06-batch-failure-queue.test.ts"
  ];
  const documentedReplacements = [
    "tests/cli/b06-partial-ack.test.ts",
    "tests/ci/b06-obsolete-queue-test-archive.test.ts"
  ];
  const expected = [...configDefaults.exclude, ...baselineProjectExclusions, ...documentedReplacements];
  expect(config.test?.include).toEqual(["tests/**/*.test.ts"]);
  expect(config.test?.exclude).toEqual(expected);
  expect(config.test?.exclude?.filter((path) => !configDefaults.exclude.includes(path)))
    .toEqual([...baselineProjectExclusions, ...documentedReplacements]);
  for (const path of [...baselineProjectExclusions, ...documentedReplacements]) {
    expect(path).not.toMatch(/[?*{}]/);
  }
  for (const active of [
    "tests/ci/b05-recovery-source.test.ts",
    "tests/evaluator/b05-evidence-retention-round2.test.ts",
    "tests/cli/agent-sync-checkpoint.test.ts",
    "tests/evaluator/bl-homepage-freshness-f002-f003.test.ts",
    "tests/cli/queue-merge.test.ts"
  ]) expect(config.test?.exclude).not.toContain(active);
});
