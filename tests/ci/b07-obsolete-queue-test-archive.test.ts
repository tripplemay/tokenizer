import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const immutable = new Map([
  ["tests/cli/b06-batch-failure-queue.test.ts", "fb406333cef1b6c8f035c8750a3a7a914da494c0670e2ee7329ff120216b6eca"],
  ["tests/cli/b06-partial-ack.test.ts", "4b8e4c10f0e173946d341586034da713718573fdaf67e9c69a0c317f04c09b33"],
  ["tests/ci/b06-obsolete-queue-test-archive.test.ts", "f73566f46cca6f185d7ad82e4a8519d07ec59c037f03ec8e4629ae0e2d728480"]
]);

describe("B07 immutable B06 regression archive", () => {
  it("keeps every historical evaluator-owned test byte-identical and explicitly excluded", () => {
    const config = readFileSync("vitest.config.ts", "utf8");
    for (const [path, hash] of immutable) {
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(hash);
      expect(config).toContain(`"${path}"`);
    }
  });

  it("has portable successor coverage for every retired B06 invariant", () => {
    const resolution = readFileSync("tests/cli/b07-queue-resolution.test.ts", "utf8");
    const native = readFileSync("tests/cli/b07-queue-multiwriter.probe.ts", "utf8");
    for (const phrase of [
      "partial ACK removes only exact versions",
      "incomplete or forged partial ACK",
      "durable quarantine is corrupt",
      "row-addressed previous-server rejection",
      "rowless previous-server invalid_json",
      "global rowless invalid_json",
      "permanent auth failure",
      "bounded transient retry"
    ]) expect(resolution).toContain(phrase);
    for (const phrase of ["newly-collected", "same-id", "crash-retry"]) expect(native).toContain(phrase);
  });
});
