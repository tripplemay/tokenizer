import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuotaLatest: vi.fn(),
  getUserTimezone: vi.fn()
}));

vi.mock("@/server/quota", () => ({ getQuotaLatest: mocks.getQuotaLatest }));
vi.mock("@/server/timezone", () => ({ getUserTimezone: mocks.getUserTimezone }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string | number>) => {
    if (key === "subscription.codex.title") return "Codex / ChatGPT";
    if (key === "subscription.codex.accountLabel") return `Account: ${values?.account}`;
    if (key === "subscription.codex.ratePrimary") return "Primary";
    if (key === "subscription.footer.refreshed") return `Refreshed ${values?.ago}`;
    return key;
  }
}));

(globalThis as Record<string, unknown>).React = React;
const { SubscriptionCard } = await import("../../app/_components/subscription-card");

function account(accountKey: string) {
  return {
    accountKey,
    capturedAt: "2026-08-10T10:00:00.000Z",
    capturedBy: null,
    windows: [
      {
        windowKey: "rate_limit_primary",
        utilization: 0.25,
        usedRaw: 25,
        limitRaw: 100,
        unit: "tokens",
        resetsAt: null,
        rawJson: null
      }
    ]
  };
}

async function render() {
  return renderToStaticMarkup(await SubscriptionCard({ userId: "user-1" }));
}

describe("SubscriptionCard account rendering", () => {
  beforeEach(() => {
    mocks.getQuotaLatest.mockReset();
    mocks.getUserTimezone.mockResolvedValue("UTC");
  });

  it("renders one card for the single-account shape", async () => {
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: { "codex-chatgpt": account("account-a") },
      accountsByProvider: { "codex-chatgpt": [account("account-a")] }
    });

    const html = await render();

    expect(html.match(/Codex \/ ChatGPT/g)).toHaveLength(1);
    expect(html).toContain("Account: account-a");
    expect(html).not.toContain("lg:grid-cols-2");
  });

  it("renders a cached legacy response during rollout", async () => {
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: { "codex-chatgpt": account("legacy-account") }
    });

    const html = await render();

    expect(html).toContain("Account: legacy-account");
  });

  it("renders a separate, labeled card for every account", async () => {
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: { "codex-chatgpt": account("account-b") },
      accountsByProvider: { "codex-chatgpt": [account("account-a"), account("account-b")] }
    });

    const html = await render();

    expect(html.match(/Codex \/ ChatGPT/g)).toHaveLength(2);
    expect(html).toContain("Account: account-a");
    expect(html).toContain("Account: account-b");
    expect(html).toContain("lg:grid-cols-2");
  });

  it("ships the account label in both locales with the same placeholder", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8"));

    expect(en.subscription.codex.accountLabel).toBe("Account: {account}");
    expect(zh.subscription.codex.accountLabel).toBe("账号：{account}");
  });
});
