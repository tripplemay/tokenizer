import { describe, expect, it } from "vitest";
import { selectClaudeLegacyCleanup, type ClaudeLegacyRow } from "@/server/cleanup";

function row(overrides: Partial<ClaudeLegacyRow> = {}): ClaudeLegacyRow {
  return {
    id: "r1",
    deviceId: "dev-1",
    sessionId: "sess-1",
    totalTokens: 100,
    sourceEventId: "claude:sess-1:hash",
    ...overrides
  };
}

describe("selectClaudeLegacyCleanup", () => {
  it("returns an empty plan when no rows are provided", () => {
    const plan = selectClaudeLegacyCleanup([], new Set());
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.groupsCount).toBe(0);
    expect(plan.tokensBefore).toBe(0);
    expect(plan.tokensAfterCleanup).toBe(0);
  });

  it("renames a single-row group to claude-legacy without deletes", () => {
    const plan = selectClaudeLegacyCleanup(
      [row({ id: "r1", sessionId: "sess-1", totalTokens: 150 })],
      new Set()
    );
    expect(plan.toUpdate).toEqual([{ id: "r1", newSourceEventId: "claude-legacy:sess-1" }]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.tokensBefore).toBe(150);
    expect(plan.tokensAfterCleanup).toBe(150);
  });

  it("keeps the max-tokens row and deletes the rest in a duplicate group", () => {
    const plan = selectClaudeLegacyCleanup(
      [
        row({ id: "r1", sessionId: "sess-1", totalTokens: 100 }),
        row({ id: "r2", sessionId: "sess-1", totalTokens: 300 }),
        row({ id: "r3", sessionId: "sess-1", totalTokens: 200 })
      ],
      new Set()
    );
    expect(plan.toUpdate).toEqual([{ id: "r2", newSourceEventId: "claude-legacy:sess-1" }]);
    expect(plan.toDelete.sort()).toEqual(["r1", "r3"]);
    expect(plan.tokensBefore).toBe(600);
    expect(plan.tokensAfterCleanup).toBe(300);
  });

  it("treats the same sessionId across different devices as separate groups", () => {
    const plan = selectClaudeLegacyCleanup(
      [
        row({ id: "r1", deviceId: "dev-A", sessionId: "sess-1", totalTokens: 100 }),
        row({ id: "r2", deviceId: "dev-B", sessionId: "sess-1", totalTokens: 200 })
      ],
      new Set()
    );
    expect(plan.groupsCount).toBe(2);
    expect(plan.toUpdate).toHaveLength(2);
    expect(plan.toDelete).toEqual([]);
  });

  it("deletes all old rows when claude-legacy already exists for the group", () => {
    const plan = selectClaudeLegacyCleanup(
      [
        row({ id: "r1", sessionId: "sess-1", totalTokens: 100 }),
        row({ id: "r2", sessionId: "sess-1", totalTokens: 300 })
      ],
      new Set(["dev-1:sess-1"])
    );
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete.sort()).toEqual(["r1", "r2"]);
    expect(plan.tokensBefore).toBe(400);
    expect(plan.tokensAfterCleanup).toBe(0);
  });

  it("counts null-sessionId rows in rowsSkippedNoSession without touching them", () => {
    const plan = selectClaudeLegacyCleanup(
      [
        row({ id: "r1", sessionId: null, totalTokens: 50 }),
        row({ id: "r2", sessionId: "sess-1", totalTokens: 100 })
      ],
      new Set()
    );
    expect(plan.rowsSkippedNoSession).toBe(1);
    expect(plan.toUpdate.map((u) => u.id)).toEqual(["r2"]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.tokensBefore).toBe(150);
    expect(plan.tokensAfterCleanup).toBe(100);
  });

  it("processes multiple groups independently in one pass", () => {
    const plan = selectClaudeLegacyCleanup(
      [
        row({ id: "r1", sessionId: "sess-1", totalTokens: 100 }),
        row({ id: "r2", sessionId: "sess-1", totalTokens: 300 }),
        row({ id: "r3", sessionId: "sess-2", totalTokens: 50 }),
        row({ id: "r4", sessionId: "sess-2", totalTokens: 75 })
      ],
      new Set()
    );
    expect(plan.groupsCount).toBe(2);
    expect(plan.toUpdate.map((u) => u.id).sort()).toEqual(["r2", "r4"]);
    expect(plan.toDelete.sort()).toEqual(["r1", "r3"]);
    expect(plan.tokensBefore).toBe(525);
    expect(plan.tokensAfterCleanup).toBe(375);
  });
});
