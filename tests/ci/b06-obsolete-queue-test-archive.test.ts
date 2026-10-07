import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const historicalPath = "tests/cli/b06-batch-failure-queue.test.ts";

describe("B06 obsolete whole-batch queue regression archive", () => {
  it("keeps the historical evaluator-owned test byte-identical and explicitly excluded", () => {
    const historical = readFileSync(historicalPath);
    expect(createHash("sha256").update(historical).digest("hex"))
      .toBe("fb406333cef1b6c8f035c8750a3a7a914da494c0670e2ee7329ff120216b6eca");
    const config = readFileSync("vitest.config.ts", "utf8");
    expect(config).toContain(`exclude: ["${historicalPath}"]`);
  });

  it("replaces the obsolete retry-and-pin behavior with portable liveness coverage", () => {
    const replacement = readFileSync("tests/cli/b06-partial-ack.test.ts", "utf8");
    for (const phrase of [
      "durably quarantines rejected IDs before checkpointing",
      "supports the prior whole-batch B06 server without retrying a permanent 400",
      "fails closed on an incomplete or forged ACK partition",
      "retains the active queue when durable quarantine is corrupt",
      "does not retry permanent auth failures",
      "keeps bounded retry for 429 and 5xx"
    ]) {
      expect(replacement).toContain(phrase);
    }
  });
});
