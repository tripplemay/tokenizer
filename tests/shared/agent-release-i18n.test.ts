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
    expect(latest).toMatchObject({ version: "1.2.0", agent_feature_version: 8 });
    expect(latest?.highlights["zh-CN"]).toEqual([
      "支持 Harness bridge 对象形式的子代理声明，避免旧 Tokenizer Agent 将有效的 Dispatch 工具目录误判为不可用。",
      "将工具绑定编排的兼容门槛提升到 capability 8，并明确提示旧 Agent 升级。"
    ]);
    expect(latest?.highlights.en).toEqual([
      "Supports Harness bridge-object subagent declarations, preventing older Tokenizer Agents from marking valid Dispatch tool catalogs unavailable.",
      "Raises the tool-bound orchestration compatibility level to 8 and clearly prompts older Agents to upgrade."
    ]);

    const allCopy = `${readFileSync("messages/en.json", "utf8")} ${readFileSync("messages/zh-CN.json", "utf8")}`;
    expect(allCopy).not.toContain("Codex quota tracking");
    expect(allCopy).not.toContain("时区采集、Codex 配额追踪");
    expect(allCopy).not.toContain("Harness sync health");
  });
});
