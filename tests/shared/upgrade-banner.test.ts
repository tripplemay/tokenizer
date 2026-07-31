import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

function translate(key: string, values?: Record<string, unknown>): string {
  const count = values?.count ?? "";
  const version = values?.version ?? "";
  return `${key}:${count}:${version}`;
}

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => translate }));

import { shouldRenderUpgradeBanner, UpgradeBanner } from "../../app/_components/upgrade-banner";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

async function renderBanner({
  outdatedCount,
  unknownCount,
}: {
  outdatedCount: number;
  unknownCount: number;
}): Promise<string> {
  const banner = await UpgradeBanner({
    outdatedCount,
    unknownCount,
    latestRelease: "1.1.0",
    highlights: ["report compatibility", "upgrade visibility"],
    commands: [{ id: "posix", label: "macOS / Linux", command: "curl install" }]
  });
  return renderToStaticMarkup(banner);
}

describe("UpgradeBanner update-state rendering", () => {
  it("renders attention for either required upgrades or unverified releases", () => {
    expect(shouldRenderUpgradeBanner(0, 0)).toBe(false);
    expect(shouldRenderUpgradeBanner(1, 0)).toBe(true);
    expect(shouldRenderUpgradeBanner(0, 1)).toBe(true);
  });

  it("renders an upgrade target, manifest highlights, and install guidance for required upgrades", async () => {
    const html = await renderBanner({ outdatedCount: 1, unknownCount: 0 });

    expect(html).toContain("upgradeBanner.message:1:1.1.0");
    expect(html).toContain("upgradeBanner.latest::1.1.0");
    expect(html).toContain("report compatibility");
    expect(html).toContain("upgrade visibility");
    expect(html).toContain("curl install");
    expect(html).not.toContain("upgradeBanner.unknownOnly");
  });

  it("renders only verification guidance for unknown-only devices", async () => {
    const html = await renderBanner({ outdatedCount: 0, unknownCount: 2 });

    expect(html).toContain("upgradeBanner.unknownOnly:2:");
    expect(html).not.toContain("upgradeBanner.message");
    expect(html).not.toContain("upgradeBanner.latest");
    expect(html).not.toContain("report compatibility");
    expect(html).not.toContain("curl install");
  });

  it("keeps both upgrade and verification guidance visible for a mixed device set", async () => {
    const html = await renderBanner({ outdatedCount: 1, unknownCount: 2 });

    expect(html).toContain("upgradeBanner.message:1:1.1.0");
    expect(html).toContain("upgradeBanner.unknown:2:");
    expect(html).toContain("curl install");
    expect(html).not.toContain("upgradeBanner.unknownOnly");
  });
});
