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
    expect(query.select.dispatchRuns.select).not.toHaveProperty("artifactPath");
    expect(query.select.dispatchRuns.select).not.toHaveProperty("artifactSha256");
  });
});
