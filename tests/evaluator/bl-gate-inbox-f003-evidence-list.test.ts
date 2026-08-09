/**
 * Evaluator-owned verification for BL-GATE-INBOX F003 (evidence 查看先行版).
 *
 * Written in a fresh context at SHA ac69897. Follows the precedent of
 * tests/evaluator/bl-transition-log-f003-timeline-view.test.ts: render the real
 * component to static markup with labels sourced from the actual message
 * bundles, and mechanize the acceptance greps so they survive as regressions.
 *
 * Asserted acceptance surface:
 *  (a) real <EvidenceList> renders badge + raw path + copy affordance for a
 *      mixed docs/-vs-plain list, drops hostile entries, and renders nothing
 *      for empty / all-junk / non-array inputs (spec §2 F003 "空数组不渲染");
 *  (b) en/zh harness.evidence key sets are identical (machine comparison);
 *  (c) all three gate render points import/use EvidenceList and the legacy
 *      bare <ul class="list-inside list-disc"> in the harness pages is gone;
 *  (d) the component stays read-only: no fetch / prisma / server-action /
 *      mutation surface in evidence-list.tsx (先行版 = pure display).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// vitest's esbuild transform compiles the app's JSX with the classic runtime;
// provide the React global before pulling in the component module.
(globalThis as Record<string, unknown>).React = React;
const { EvidenceList } = await import("../../app/harness/evidence-list");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const enMessages = JSON.parse(read("messages/en.json")) as {
  harness: { evidence: Record<string, string> };
};
const zhMessages = JSON.parse(read("messages/zh-CN.json")) as {
  harness: { evidence: Record<string, string> };
};

const enLabels = {
  repoDoc: enMessages.harness.evidence.repoDoc,
  path: enMessages.harness.evidence.path,
  copy: enMessages.harness.evidence.copy,
  copied: enMessages.harness.evidence.copied
};

function renderList(evidence: unknown): string {
  return renderToStaticMarkup(createElement(EvidenceList, { evidence, labels: enLabels }));
}

describe("BL-GATE-INBOX F003 EvidenceList smoke render (real component, en messages)", () => {
  it("renders repo-doc and plain-path badges with raw paths and a copy button", () => {
    const markup = renderList([
      "docs/test-reports/BL-X-signoff.md",
      "tests/cli/harness.test.ts"
    ]);
    // classification badges use the real bundle labels
    expect(markup).toContain(enLabels.repoDoc);
    expect(markup).toContain(enLabels.path);
    // raw paths are shown verbatim
    expect(markup).toContain("docs/test-reports/BL-X-signoff.md");
    expect(markup).toContain("tests/cli/harness.test.ts");
    // copy affordance labelled from the bundle (one per item)
    expect(markup.split(`aria-label="${enLabels.copy}"`).length - 1).toBe(2);
  });

  it("drops hostile entries but keeps traversal-looking strings as plain display", () => {
    const markup = renderList(["docs/a.md", 42, "", "   ", "x".repeat(513), "../outside"]);
    expect(markup).toContain("docs/a.md");
    expect(markup).toContain("../outside"); // display-only, never dereferenced
    expect(markup).not.toContain("x".repeat(513));
    // 42 / blanks dropped -> exactly 2 list items
    expect(markup.split("<li").length - 1).toBe(2);
  });

  it("renders nothing for empty, all-junk, or non-array evidence", () => {
    expect(renderList([])).toBe("");
    expect(renderList([7, "", null])).toBe("");
    expect(renderList(null)).toBe("");
    expect(renderList("docs/a.md")).toBe("");
    expect(renderList({ evidence: ["docs/a.md"] })).toBe("");
  });
});

describe("BL-GATE-INBOX F003 i18n parity (harness.evidence)", () => {
  it("en and zh-CN expose identical harness.evidence key sets with non-empty values", () => {
    const enKeys = Object.keys(enMessages.harness.evidence).sort();
    const zhKeys = Object.keys(zhMessages.harness.evidence).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toEqual(["copied", "copy", "path", "repoDoc"]);
    for (const key of enKeys) {
      expect(enMessages.harness.evidence[key].trim().length).toBeGreaterThan(0);
      expect(zhMessages.harness.evidence[key].trim().length).toBeGreaterThan(0);
    }
  });
});

describe("BL-GATE-INBOX F003 render-point wiring (mechanized acceptance greps)", () => {
  const listPage = read("app/harness/page.tsx");
  const detailViews = read("app/harness/[id]/views.tsx");

  it("all three gate render points use EvidenceList", () => {
    // list page: one gate card render point
    expect(listPage).toContain('import { EvidenceList } from "./evidence-list"');
    expect(listPage.match(/<EvidenceList\b/g) ?? []).toHaveLength(1);
    // detail page: overview pendingGate + activity gates
    expect(detailViews).toContain('import { EvidenceList } from "../evidence-list"');
    expect(detailViews.match(/<EvidenceList\b/g) ?? []).toHaveLength(2);
  });

  it("the legacy bare evidence list markup is gone from the harness pages", () => {
    for (const source of [listPage, detailViews]) {
      expect(source).not.toContain("list-inside");
      expect(source).not.toContain("list-disc");
    }
  });

  it("detail gates select carries the evidence column", () => {
    const detailQuery = read("src/server/harness-detail.ts");
    const gatesSelect = detailQuery.slice(
      detailQuery.indexOf("gates:"),
      detailQuery.indexOf("modeIntents:")
    );
    expect(gatesSelect).toContain("evidence: true");
  });
});

describe("BL-GATE-INBOX F003 read-only semantics", () => {
  it("evidence-list.tsx has no fetch or write surface", () => {
    const source = read("app/harness/evidence-list.tsx");
    for (const forbidden of ["fetch(", "prisma", "use server", "axios", "useSWR", "POST"]) {
      expect(source).not.toContain(forbidden);
    }
    // the only browser API used is the clipboard writer inside onClick
    expect(source).toContain("navigator.clipboard");
  });
});
