import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import agentReleasesManifest from "../../src/shared/agent-releases.json";

function pick(root: Record<string, unknown>, path: string[]) {
  return path.reduce((value, key) => (value as Record<string, unknown>)[key], root as unknown);
}

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) => leafKeys(nested, `${prefix}.${key}`));
}

describe("Agent release update copy", () => {
  it("keeps release-state copy and placeholders symmetric across locales", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8")) as Record<string, unknown>;
    for (const path of [
      ["upgradeBanner"],
      ["devices", "agentReleaseBadge"],
      ["device", "diagnostics"]
    ]) {
      const english = pick(en, path);
      const chinese = pick(zh, path);
      expect(leafKeys(english).sort()).toEqual(leafKeys(chinese).sort());
      expect(JSON.stringify(english).match(/\{[a-zA-Z]+\}/g)?.sort() ?? [])
        .toEqual(JSON.stringify(chinese).match(/\{[a-zA-Z]+\}/g)?.sort() ?? []);
    }
  });

  it("uses the release manifest as the source of the newest feature description", () => {
    const latest = agentReleasesManifest.releases.at(-1);
    expect(latest?.highlights["zh-CN"].join(" ")).toContain("Harness");
    expect(latest?.highlights.en.join(" ")).toContain("Harness sync health");

    const allCopy = `${readFileSync("messages/en.json", "utf8")} ${readFileSync("messages/zh-CN.json", "utf8")}`;
    expect(allCopy).not.toContain("Codex quota tracking");
    expect(allCopy).not.toContain("时区采集、Codex 配额追踪");
  });
});
