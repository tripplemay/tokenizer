import { describe, expect, it } from "vitest";
import { dedupeBySourceEventId } from "@/cli/collect";
import type { UsageEventInput } from "@/shared/usage";

function event(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    source: "claude-code",
    sourceEventId: "claude-jsonl:msg-1:uuid-1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    ...overrides
  };
}

describe("dedupeBySourceEventId", () => {
  it("returns an empty array for empty input", () => {
    expect(dedupeBySourceEventId([])).toEqual([]);
  });

  it("returns the original events when sourceEventIds are all unique", () => {
    const events = [
      event({ sourceEventId: "claude-jsonl:msg-1:u1" }),
      event({ sourceEventId: "claude-jsonl:msg-2:u2" }),
      event({ sourceEventId: "opencode:msg-3", source: "opencode" })
    ];
    const result = dedupeBySourceEventId(events);
    expect(result).toHaveLength(3);
  });

  it("collapses duplicates with the same (source, sourceEventId) keeping the later occurrence", () => {
    const result = dedupeBySourceEventId([
      event({ sourceEventId: "claude-jsonl:msg-1:u1", inputTokens: 5 }),
      event({ sourceEventId: "claude-jsonl:msg-1:u1", inputTokens: 50 }),
      event({ sourceEventId: "claude-jsonl:msg-2:u2", inputTokens: 7 })
    ]);
    expect(result).toHaveLength(2);
    const first = result.find((e) => e.sourceEventId === "claude-jsonl:msg-1:u1");
    expect(first?.inputTokens).toBe(50);
  });

  it("does not conflate events with the same sourceEventId but different sources", () => {
    const result = dedupeBySourceEventId([
      event({ source: "claude-code", sourceEventId: "shared:abc" }),
      event({ source: "opencode", sourceEventId: "shared:abc" })
    ]);
    expect(result).toHaveLength(2);
  });
});
