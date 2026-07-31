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
  it("renders the synced v1.6.0 project as latest without stale guidance", async () => {
    const html = await renderModeBadges("1.6.0");

    expect(html).toContain("v1.6.0");
    expect(html).not.toContain("behindN:");
    expect(html).not.toContain("ahead:");
    expect(html).not.toContain("syncHint");
  });

  it("renders v1.5.3 as one release behind with sync guidance", async () => {
    const html = await renderModeBadges("1.5.3");

    expect(html).toContain("v1.5.3");
    expect(html).toContain("behindN:1");
    expect(html).toContain("syncHint");
    expect(html).not.toContain("ahead:");
  });

  it("keeps a future version as ahead without a misleading sync hint", async () => {
    const html = await renderModeBadges("9.9.9");

    expect(html).toContain("v9.9.9");
    expect(html).toContain("ahead:1.6.0");
    expect(html).not.toContain("behindN:");
    expect(html).not.toContain("syncHint");
  });
});
