import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import frameworkReleasesManifest from "../../framework/harness/framework-releases.json";

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

const MANIFEST_RELEASE_VERSIONS = frameworkReleasesManifest.releases.map((release) => release.version);
const LATEST_MANIFEST_VERSION = MANIFEST_RELEASE_VERSIONS.at(-1);
const PREVIOUS_MANIFEST_VERSION = MANIFEST_RELEASE_VERSIONS.at(-2);

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
  it(`renders the synced v${LATEST_MANIFEST_VERSION} project as latest without stale guidance`, async () => {
    const html = await renderModeBadges(LATEST_MANIFEST_VERSION);

    expect(html).toContain(`v${LATEST_MANIFEST_VERSION}`);
    expect(html).not.toContain("behindN:");
    expect(html).not.toContain("ahead:");
    expect(html).not.toContain("syncHint");
  });

  it(`renders v${PREVIOUS_MANIFEST_VERSION} as one release behind with sync guidance`, async () => {
    const html = await renderModeBadges(PREVIOUS_MANIFEST_VERSION);

    expect(html).toContain(`v${PREVIOUS_MANIFEST_VERSION}`);
    expect(html).toContain("behindN:1");
    expect(html).toContain("syncHint");
    expect(html).not.toContain("ahead:");
  });

  it("keeps a future version as ahead without a misleading sync hint", async () => {
    const html = await renderModeBadges("9.9.9");

    expect(html).toContain("v9.9.9");
    expect(html).toContain(`ahead:${LATEST_MANIFEST_VERSION}`);
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
