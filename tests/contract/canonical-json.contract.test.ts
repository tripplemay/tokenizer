import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/server/harness-sign";

type CanonicalVector = {
  name: string;
  input: unknown;
  expected: string;
};

const fixturesDir = process.env.CONTRACT_FIXTURES_DIR;
const fixturesAvailable = Boolean(fixturesDir && existsSync(fixturesDir));

function fixturePath(...parts: string[]): string {
  if (!fixturesDir) throw new Error("CONTRACT_FIXTURES_DIR is not configured");
  return join(fixturesDir, ...parts);
}

describe.skipIf(!fixturesAvailable)("contract fixtures: canonical JSON", () => {
  it("matches every framework vector byte for byte", () => {
    const fixture = JSON.parse(
      readFileSync(fixturePath("canonical-json", "vectors.json"), "utf8")
    ) as { vectors: CanonicalVector[] };

    expect(fixture.vectors.length).toBeGreaterThan(0);
    for (const vector of fixture.vectors) {
      expect(
        Buffer.from(canonicalJson(vector.input), "utf8"),
        `canonical vector ${vector.name}`
      ).toEqual(Buffer.from(vector.expected, "utf8"));
    }
  });
});
