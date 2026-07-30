import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { HarnessHealthBadge, type HarnessHealthLabels } from "../../app/_components/harness-health-badge";
import {
  HARNESS_SYNC_ISSUE_LIMIT,
  HARNESS_SYNC_STALE_MS,
  harnessDiagnosticsFromSnapshot,
  harnessHealthKey,
  harnessSnapshotFromPersisted,
  parseHarnessSyncSnapshot,
  safeHarnessCode,
  safeHarnessProject,
  type HarnessSyncSnapshot
} from "@/shared/harness-health";

const ATTEMPTED_AT = "2026-07-30T12:00:00.000Z";
const NOW = Date.parse(ATTEMPTED_AT);

function snapshot(overrides: Partial<HarnessSyncSnapshot> = {}): HarnessSyncSnapshot {
  return {
    attemptedAt: ATTEMPTED_AT,
    status: "degraded",
    reported: 2,
    failed: 1,
    relayed: 0,
    modeIntents: 1,
    issues: [{ operation: "report", project: "tokenizer", code: "http_400", retryable: false }],
    ...overrides
  };
}

const LABELS: HarnessHealthLabels = {
  idle: "idle",
  success: "healthy",
  degraded: "partial",
  failed: "failed",
  stale: "stale",
  "not-reported": "not reported"
};

describe("Harness health runtime contract", () => {
  it("accepts and reconstructs the exact bounded snapshot shape", () => {
    const value = snapshot();
    expect(parseHarnessSyncSnapshot(value)).toEqual(value);
    expect(
      harnessSnapshotFromPersisted(value.attemptedAt, value.status, harnessDiagnosticsFromSnapshot(value))
    ).toEqual(value);
  });

  it.each([
    ["unknown snapshot field", { ...snapshot(), detail: "raw body" }],
    ["non-UTC timestamp", snapshot({ attemptedAt: "2026-07-30T12:00:00+00:00" })],
    ["invalid date", snapshot({ attemptedAt: "2026-02-30T12:00:00.000Z" })],
    ["unknown status", { ...snapshot(), status: "partial" }],
    ["negative count", snapshot({ failed: -1 })],
    ["fractional count", snapshot({ reported: 1.5 })],
    ["unsafe project path", snapshot({ issues: [{ operation: "report", project: "/Users/alice/repo", code: "http_400", retryable: false }] })],
    ["unsafe code", snapshot({ issues: [{ operation: "report", project: "tokenizer", code: "token=secret", retryable: false }] })],
    ["unknown issue field", snapshot({ issues: [{ operation: "report", project: "tokenizer", code: "http_400", retryable: false, body: "raw" } as never] })],
    ["unknown operation", snapshot({ issues: [{ operation: "upload" as never, project: "tokenizer", code: "http_400", retryable: false }] })],
    ["too many issues", snapshot({ issues: Array.from({ length: HARNESS_SYNC_ISSUE_LIMIT + 1 }, () => ({ operation: "report" as const, project: "p", code: "http_500", retryable: true })) })]
  ])("rejects %s", (_label, value) => {
    expect(parseHarnessSyncSnapshot(value)).toBeNull();
  });

  it("only accepts normalized codes and bounded non-path project names", () => {
    expect(safeHarnessCode("network_error")).toBe("network_error");
    expect(safeHarnessCode("Network Error")).toBeNull();
    expect(safeHarnessProject("x".repeat(201))).toBe("x".repeat(200));
    expect(safeHarnessProject("repo?token=secret")).toBeNull();
  });
});

describe("shared Harness freshness and badge rendering", () => {
  it("uses one strict greater-than three-minute freshness boundary", () => {
    expect(harnessHealthKey("success", ATTEMPTED_AT, NOW + HARNESS_SYNC_STALE_MS)).toBe("success");
    expect(harnessHealthKey("failed", ATTEMPTED_AT, NOW + HARNESS_SYNC_STALE_MS + 1)).toBe("stale");
    expect(harnessHealthKey(null, ATTEMPTED_AT, NOW)).toBe("not-reported");
    expect(harnessHealthKey("success", null, NOW)).toBe("not-reported");
  });

  it.each([
    ["success", ATTEMPTED_AT, NOW, "healthy"],
    ["degraded", ATTEMPTED_AT, NOW, "partial"],
    ["failed", ATTEMPTED_AT, NOW, "failed"],
    ["success", ATTEMPTED_AT, NOW + HARNESS_SYNC_STALE_MS + 1, "stale"],
    [null, null, NOW, "not reported"]
  ])("renders the %s branch without changing badge dimensions", (status, attemptedAt, nowMs, label) => {
    const html = renderToStaticMarkup(createElement(HarnessHealthBadge, {
      status,
      attemptedAt,
      nowMs,
      labels: LABELS
    }));
    expect(html).toContain(`data-harness-health=`);
    expect(html).toContain(label);
    expect(html).toContain("max-w-full");
  });

  it("keeps all three existing pages on the shared badge instead of local thresholds", () => {
    for (const path of ["app/devices/page.tsx", "app/devices/[id]/page.tsx", "app/harness/page.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("HarnessHealthBadge");
      expect(source).not.toContain("3 * 60 * 1000");
    }
  });
});

describe("Harness health locale parity", () => {
  it("keeps new key paths and placeholders symmetric", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8"));
    for (const path of [
      ["device", "diagnostics", "harness"],
      ["devices", "diag", "harnessStatus"],
      ["harness", "syncHealth"]
    ]) {
      const pick = (root: Record<string, unknown>) => path.reduce((value, key) => (value as Record<string, unknown>)[key], root as unknown);
      const left = JSON.stringify(pick(en));
      const right = JSON.stringify(pick(zh));
      const keys = (value: unknown, prefix = ""): string[] =>
        typeof value === "object" && value !== null
          ? Object.entries(value).flatMap(([key, nested]) => keys(nested, `${prefix}.${key}`))
          : [prefix];
      expect(keys(JSON.parse(left)).sort()).toEqual(keys(JSON.parse(right)).sort());
      expect(left.match(/\{[a-zA-Z]+\}/g)?.sort() ?? []).toEqual(right.match(/\{[a-zA-Z]+\}/g)?.sort() ?? []);
    }
  });
});
