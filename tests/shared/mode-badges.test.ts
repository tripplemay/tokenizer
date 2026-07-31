import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => {
    if (key === "behindN") return `behindN:${values?.count}`;
    if (key === "ahead") return `ahead:${values?.latest}`;
    return key;
  }
}));

import ModeBadges from "../../app/harness/mode-badges";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

async function renderModeBadges(version: string): Promise<string> {
  const node = await ModeBadges({
    modes: {
      execution: "unknown",
      framework: { version }
    }
  });
  return renderToStaticMarkup(node);
}

describe("ModeBadges framework release rendering", () => {
  it("renders the synced v1.6.1 project as latest without stale guidance", async () => {
    const html = await renderModeBadges("1.6.1");

    expect(html).toContain("v1.6.1");
    expect(html).not.toContain("behindN:");
    expect(html).not.toContain("ahead:");
    expect(html).not.toContain("syncHint");
  });

  it("renders v1.6.0 as one release behind with sync guidance", async () => {
    const html = await renderModeBadges("1.6.0");

    expect(html).toContain("v1.6.0");
    expect(html).toContain("behindN:1");
    expect(html).toContain("syncHint");
    expect(html).not.toContain("ahead:");
  });

  it("keeps a future version as ahead without a misleading sync hint", async () => {
    const html = await renderModeBadges("9.9.9");

    expect(html).toContain("v9.9.9");
    expect(html).toContain("ahead:1.6.1");
    expect(html).not.toContain("behindN:");
    expect(html).not.toContain("syncHint");
  });

  it("falls back to legacy generator and evaluator assignments when no v2 resolution is reported", async () => {
    const node = await ModeBadges({
      modes: {
        execution: "heterogeneous",
        dispatch: {
          enabled: true,
          assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
        }
      }
    });
    const html = renderToStaticMarkup(node);

    expect(html).toContain("builder-codex → reviewer-kimi");
  });

  it("keeps a complete legacy pair when the current v2 resolution is partial", async () => {
    const node = await ModeBadges({
      modes: {
        execution: "heterogeneous",
        current: { roleBindings: { generator: { tool: "codex" } } },
        dispatch: {
          enabled: true,
          assignments: { generator: "builder-codex", evaluator: "reviewer-kimi" }
        }
      }
    });
    const html = renderToStaticMarkup(node);

    expect(html).toContain('title="builder-codex → reviewer-kimi"');
  });
});
