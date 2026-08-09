import { describe, expect, it } from "vitest";
import { classifyEvidence, classifyEvidenceList } from "../../src/shared/harness-evidence";

describe("evidence classification", () => {
  it("marks docs/ paths as repo docs and everything else as plain paths", () => {
    expect(classifyEvidence("docs/test-reports/x.md")).toEqual({
      raw: "docs/test-reports/x.md",
      kind: "repoDoc"
    });
    expect(classifyEvidence("tests/x.test.ts")).toEqual({ raw: "tests/x.test.ts", kind: "path" });
  });

  it("never throws on hostile input and drops junk entries", () => {
    expect(classifyEvidence("")).toBeNull();
    expect(classifyEvidence("   ")).toBeNull();
    expect(classifyEvidence("x".repeat(513))).toBeNull();
    expect(classifyEvidence(42)).toBeNull();
    expect(classifyEvidence(null)).toBeNull();
    // 路径穿越样式按普通路径呈现（只读展示，不解引用）
    expect(classifyEvidence("../outside")).toEqual({ raw: "../outside", kind: "path" });
  });

  it("filters lists and returns empty for non-arrays", () => {
    expect(classifyEvidenceList(["docs/a.md", 7, "", "b.txt"])).toEqual([
      { raw: "docs/a.md", kind: "repoDoc" },
      { raw: "b.txt", kind: "path" }
    ]);
    expect(classifyEvidenceList(null)).toEqual([]);
    expect(classifyEvidenceList("docs/a.md")).toEqual([]);
  });
});
