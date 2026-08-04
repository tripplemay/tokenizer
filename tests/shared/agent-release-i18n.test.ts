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
    expect(latest).toMatchObject({ version: "1.2.1", agent_feature_version: 9 });
    expect(latest?.highlights["zh-CN"]).toEqual([
      "升级安装器与后台 Agent 生命周期，确保升级时旧 wrapper 与 Node 子进程一并退出，避免旧版本并发上报覆盖设备状态。",
      "服务端拒绝过期 Agent 覆盖已接受诊断或 Harness 控制面状态，并在设备页显示被接受上报的 Token 前缀和时间。"
    ]);
    expect(latest?.highlights.en).toEqual([
      "Hardens installer and background Agent lifecycle so upgrades stop both the old wrapper and Node child before they can report concurrently.",
      "Prevents stale Agents from overwriting accepted diagnostics or Harness control-plane state, and shows the accepted reporter token prefix and time on the device page."
    ]);

    const allCopy = `${readFileSync("messages/en.json", "utf8")} ${readFileSync("messages/zh-CN.json", "utf8")}`;
    expect(allCopy).not.toContain("Codex quota tracking");
    expect(allCopy).not.toContain("时区采集、Codex 配额追踪");
    expect(allCopy).not.toContain("Harness sync health");
  });
});
