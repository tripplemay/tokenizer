// Independent evaluator regression probes for BL-HOMEPAGE-CODEX-QUOTA.
// Authored by the F005 evaluator at SHA d6bc7f4e4e565329adb3f08f20aea6df3e8ad7fc;
// complements (does not duplicate) the generator's suite.
import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getQuotaFreshness, getQuotaRemaining, orderQuotaAccounts, QUOTA_FRESHNESS_MS } from "@/shared/quota-presentation";
import type { QuotaLatestProvider } from "@/server/quota";
import { createTranslator } from "next-intl";

const mocks = vi.hoisted(() => ({
  getQuotaLatest: vi.fn(),
  getUserTimezone: vi.fn(),
  getLocale: vi.fn(),
  getTranslations: vi.fn()
}));

vi.mock("@/server/quota", () => ({ getQuotaLatest: mocks.getQuotaLatest }));
vi.mock("@/server/timezone", () => ({ getUserTimezone: mocks.getUserTimezone }));
vi.mock("next-intl/server", () => ({
  getLocale: mocks.getLocale,
  getTranslations: mocks.getTranslations
}));

(globalThis as Record<string, unknown>).React = React;
const { SubscriptionCard } = await import("../../app/_components/subscription-card");

const NOW = Date.parse("2026-09-11T00:00:00.000Z");

function account(accountKey: string, capturedAt = "2026-09-10T23:00:00.000Z"): QuotaLatestProvider {
  return {
    accountKey,
    capturedAt,
    capturedBy: null,
    windows: [
      {
        windowKey: "rate_limit_primary",
        capturedAt,
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

describe("evaluator probes: account ordering", () => {
  it("falls back to accountKey order when every account time is unusable", () => {
    const accounts = [account("z", "not-a-date"), account("m", "2999-01-01T00:00:00Z"), account("a", "")];
    expect(orderQuotaAccounts(accounts, NOW).map((a) => a.accountKey)).toEqual(["a", "m", "z"]);
  });

  it("promotes the older valid report over a future-dated one for the main region", async () => {
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: {},
      accountsByProvider: {
        "codex-chatgpt": [account("future-acct", "2999-01-01T00:00:00.000Z"), account("valid-acct")]
      }
    });
    mocks.getUserTimezone.mockResolvedValue("UTC");
    mocks.getLocale.mockResolvedValue("en");
    mocks.getTranslations.mockResolvedValue((key: string, values?: Record<string, string | number>) =>
      key === "subscription.codex.otherAccounts" ? `Other account snapshots (${values?.count})` : key);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const html = await render();
    vi.useRealTimers();
    expect(html.indexOf("valid-acct")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("future-acct")).toBeGreaterThan(html.indexOf("<details"));
    expect(html.match(/<details\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });
});

describe("evaluator probes: freshness and remaining edges", () => {
  it("treats capture exactly 15min old as fresh and 1ms older as stale", () => {
    const at = (age: number) => new Date(NOW - age).toISOString();
    expect(getQuotaFreshness({ capturedAt: at(QUOTA_FRESHNESS_MS) }, NOW).pendingRefresh).toBe(false);
    expect(getQuotaFreshness({ capturedAt: at(QUOTA_FRESHNESS_MS + 1) }, NOW).pendingRefresh).toBe(true);
  });

  it("treats resetsAt exactly at now as passed and 1ms in the future as pending-reset-free", () => {
    const fresh = new Date(NOW).toISOString();
    expect(getQuotaFreshness({ capturedAt: fresh, resetsAt: new Date(NOW).toISOString() }, NOW).pendingRefresh).toBe(true);
    expect(getQuotaFreshness({ capturedAt: fresh, resetsAt: new Date(NOW + 1).toISOString() }, NOW).pendingRefresh).toBe(false);
  });

  it("keeps boundary utilization 0 and 1 renderable (100% and 0% remaining)", () => {
    expect(getQuotaRemaining(0, false)).toBe(100);
    expect(getQuotaRemaining(1, false)).toBe(0);
  });

  it("rejects a negative credit balance as unknown", async () => {
    const snapshot = account("neg-credit", "2026-09-11T00:00:00.000Z");
    snapshot.windows = [{ ...snapshot.windows[0], windowKey: "credit_balance", rawJson: { balance: -5 } }];
    mocks.getQuotaLatest.mockResolvedValue({ byProvider: {}, accountsByProvider: { "codex-chatgpt": [snapshot] } });
    mocks.getUserTimezone.mockResolvedValue("UTC");
    mocks.getLocale.mockResolvedValue("en");
    const messages = JSON.parse(readFileSync("messages/en.json", "utf8"));
    mocks.getTranslations.mockResolvedValue(createTranslator({ locale: "en", messages, onError: (e) => { throw e; } }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const html = await render();
    vi.useRealTimers();
    expect(html).not.toContain("$-5");
    expect(html).not.toContain("-5.00");
    expect(html).toContain("Unknown");
  });
});

describe("evaluator probes: i18n hygiene", () => {
  it("keeps codex/empty/free-text values free of raw keys, ICU leaks and stale relative-reset phrasing", () => {
    for (const locale of ["en", "zh-CN"]) {
      const codex = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).subscription.codex;
      for (const [key, value] of Object.entries(codex)) {
        expect(value, `${locale}:${key}`).not.toMatch(/ago ago|前前|前后重置|resets in|\{[a-z]+\}.*\{account\}.*\{account\}/is);
        expect(value, `${locale}:${key}`).not.toMatch(/^subscription\./);
      }
    }
  });

  it("subscription.codex key sets are identical across locales", () => {
    const en = Object.keys(JSON.parse(readFileSync("messages/en.json", "utf8")).subscription.codex).sort();
    const zh = Object.keys(JSON.parse(readFileSync("messages/zh-CN.json", "utf8")).subscription.codex).sort();
    expect(zh).toEqual(en);
  });
});
