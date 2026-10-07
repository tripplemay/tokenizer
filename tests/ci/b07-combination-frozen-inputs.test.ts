import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("retains baseline evaluator bytes and transports frozen B03/B07 evidence without rewriting hashes", () => {
  const manifest = JSON.parse(readFileSync(
    "docs/test-reports/BL-PRIVACY-QUEUE-CLOSEOUT-generator-20261008/frozen-inputs.json", "utf8"
  )) as { baseline: string; records: Array<{ path: string; from: string; sha256: string }> };
  expect(manifest.baseline).toBe("f8449e8");
  expect(manifest.records).toHaveLength(1025);
  for (const record of manifest.records) {
    expect(createHash("sha256").update(readFileSync(record.path)).digest("hex"), record.path)
      .toBe(record.sha256);
  }
  const attributes = execFileSync("git", ["check-attr", "--stdin", "text"], {
    encoding: "utf8", input: manifest.records.map(({ path }) => path).join("\n") + "\n"
  }).trim().split("\n");
  expect(attributes).toHaveLength(manifest.records.length);
  expect(attributes.every((line) => line.endsWith(": text: unset"))).toBe(true);
});
