import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const archivedTests = [
  "tests/cli/b06-batch-failure-queue.test.ts",
  "tests/cli/b06-partial-ack.test.ts",
  "tests/ci/b06-obsolete-queue-test-archive.test.ts"
];

describe("B07 historical test checkout policy", () => {
  it("disables checkout newline conversion for each byte-pinned B06 test", () => {
    for (const path of archivedTests) {
      const attribute = execFileSync("git", ["check-attr", "text", "--", path], { encoding: "utf8" });
      expect(attribute.trim()).toBe(`${path}: text: unset`);
    }
  });
});
