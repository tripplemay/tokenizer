import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function lockedVersion(path: string): string {
  const version = lock.packages[path]?.version;
  if (!version) throw new Error(`missing lockfile package: ${path}`);
  return version;
}

describe("production dependency security floor", () => {
  it("does not reintroduce the vulnerable Next 15/PostCSS and next-intl 3 graph", () => {
    expect(versionAtLeast(lockedVersion("node_modules/next"), "16.4.0")).toBe(true);
    expect(versionAtLeast(lockedVersion("node_modules/next/node_modules/postcss"), "8.5.23")).toBe(true);
    expect(versionAtLeast(lockedVersion("node_modules/next-intl"), "4.14.9")).toBe(true);
  });

  it("keeps the Next 16 browser mapping transitive above its DoS advisory range", () => {
    expect(versionAtLeast(lockedVersion("node_modules/baseline-browser-mapping"), "2.11.0")).toBe(true);
  });
});
