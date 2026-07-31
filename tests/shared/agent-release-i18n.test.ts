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
    expect(latest).toMatchObject({ version: "1.1.0", agent_feature_version: 7 });
    expect(latest?.highlights["zh-CN"]).toEqual([
      "改善 Harness 工具目录升级期间的项目上报兼容性，避免旧 Agent 的空目录中断上报。",
      "区分必须升级与版本待核验的设备，并在首页展示可操作的升级提示。"
    ]);
    expect(latest?.highlights.en).toEqual([
      "Improves Harness project-report compatibility during the tool-catalog rollout, preventing legacy empty catalogs from interrupting reporting.",
      "Distinguishes required upgrades from unverified releases and surfaces actionable upgrade guidance on the home page."
    ]);

    const allCopy = `${readFileSync("messages/en.json", "utf8")} ${readFileSync("messages/zh-CN.json", "utf8")}`;
    expect(allCopy).not.toContain("Codex quota tracking");
    expect(allCopy).not.toContain("时区采集、Codex 配额追踪");
    expect(allCopy).not.toContain("Harness sync health");
  });
});
