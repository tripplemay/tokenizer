import { describe, expect, it } from "vitest";
import { ownedHarnessProjectDetailQuery } from "@/server/harness-detail";

describe("owned Harness project detail query", () => {
  it("scopes the root lookup and every history relation to the session user", () => {
    const query = ownedHarnessProjectDetailQuery("project-1", "user-1");
    expect(query.where).toEqual({ id: "project-1", userId: "user-1" });
    expect(query.select.gates.where).toEqual({ userId: "user-1" });
    expect(query.select.modeIntents.where).toEqual({ userId: "user-1" });
    expect(query.select.dispatchRuns.where).toEqual({ userId: "user-1" });
    expect(query.select.transitions.where).toEqual({ userId: "user-1" });
  });

  it("bounds all timelines and omits raw or sensitive fields from the selected result", () => {
    const query = ownedHarnessProjectDetailQuery("project-1", "user-1");
    expect(query.select.gates.take).toBe(50);
    expect(query.select.modeIntents.take).toBe(50);
    expect(query.select.dispatchRuns.take).toBe(50);
    expect(query.select.transitions.take).toBe(100);
    expect(query.select.gates.select).not.toHaveProperty("decisionSig");
    expect(query.select.modeIntents.select).not.toHaveProperty("signature");
    expect(query.select.modeIntents.select).not.toHaveProperty("payload");
    // BL-GATE-INBOX F005 反转：两字段入库前已过服务端校验（repo-relative ≤512 无
    // 穿越 + SHA256 格式，见 harness-mode-intent-api 的 repoRelativeArtifactPath），
    // 非 raw 通道，准许进入详情展示白名单
    expect(query.select.dispatchRuns.select).toHaveProperty("artifactPath");
    expect(query.select.dispatchRuns.select).toHaveProperty("artifactSha256");
  });
});
