import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderQuotaAccounts } from "@/shared/quota-presentation";
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

function account(accountKey: string, capturedAt = "2026-08-10T10:00:00.000Z"): QuotaLatestProvider {
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

function setAccounts(accounts: QuotaLatestProvider[]) {
  mocks.getQuotaLatest.mockResolvedValue({ byProvider: {}, accountsByProvider: { "codex-chatgpt": accounts } });
}

describe("SubscriptionCard account rendering", () => {
  beforeEach(() => {
    mocks.getQuotaLatest.mockReset();
    mocks.getUserTimezone.mockResolvedValue("UTC");
    mocks.getLocale.mockResolvedValue("en");
    mocks.getTranslations.mockResolvedValue((key: string, values?: Record<string, string | number>) => {
      if (key === "subscription.codex.title") return "Codex / ChatGPT";
      if (key === "subscription.codex.accountLabel") return `Account: ${values?.account}`;
      if (key === "subscription.codex.ratePrimary") return "Primary";
      if (key === "subscription.codex.otherAccounts") return `Other account snapshots (${values?.count})`;
      if (key === "subscription.codex.pendingRefresh") return "Awaiting refresh";
      if (key === "subscription.codex.unknownValue") return "Unknown";
      return key;
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("renders one card for the single-account shape", async () => {
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: { "codex-chatgpt": account("account-a") },
      accountsByProvider: { "codex-chatgpt": [account("account-a")] }
    });

    const html = await render();

    expect(html.match(/Codex \/ ChatGPT/g)).toHaveLength(1);
    expect(html).toContain("Account: account-a");
    expect(html).not.toContain("lg:grid-cols-2");
    expect(html).not.toContain("<details");
  });

  it("renders a cached legacy response during rollout", async () => {
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: { "codex-chatgpt": account("legacy-account") }
    });

    const html = await render();

    expect(html).toContain("Account: legacy-account");
  });

  it("renders one Codex card with the latest account outside native collapsed details", async () => {
    const older = account("account-a");
    const newest = account("account-z", "2026-08-10T11:00:00.000Z");
    mocks.getQuotaLatest.mockResolvedValue({
      byProvider: { "codex-chatgpt": older },
      accountsByProvider: { "codex-chatgpt": [older, newest] }
    });

    const html = await render();

    expect(html.match(/Codex \/ ChatGPT/g)).toHaveLength(1);
    expect(html).toContain("Account: account-a");
    expect(html).toContain("Account: account-z");
    expect(html).not.toContain("lg:grid-cols-2");
    expect(html.match(/<details\b/g)).toHaveLength(1);
    expect(html.match(/shadow-3xl/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toMatch(/<summary[^>]*>Other account snapshots \(1\)<\/summary>/);
    expect(html.indexOf("Account: account-z")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("Account: account-a")).toBeGreaterThan(html.indexOf("<details"));
  });

  it("preserves the empty-state guidance", async () => {
    mocks.getQuotaLatest.mockResolvedValue({ byProvider: {}, accountsByProvider: {} });
    const html = await render();
    expect(html).toContain("subscription.empty.title");
    expect(html).toContain("https://github.com/openai/codex");
    expect(html).not.toContain("<details");
  });

  it("orders shuffled accounts by capture time without mutating the API array", () => {
    const accounts = [account("a"), account("z", "2026-08-10T11:00:00Z"), account("b", "2026-08-10T10:30:00Z")];
    expect(orderQuotaAccounts(accounts, Date.now()).map((item) => item.accountKey)).toEqual(["z", "b", "a"]);
    expect(accounts.map((item) => item.accountKey)).toEqual(["a", "z", "b"]);
  });

  it("uses accountKey as a deterministic tie-breaker, including equivalent ISO offsets", async () => {
    const accounts = [account("z"), account("b"), account("a", "2026-08-10T18:00:00+08:00")];
    mocks.getQuotaLatest.mockResolvedValue({ byProvider: {}, accountsByProvider: { "codex-chatgpt": accounts } });
    const html = await render();
    expect(html.indexOf("Account: a")).toBeLessThan(html.indexOf("<details"));
    expect(orderQuotaAccounts(accounts, Date.now()).map((item) => item.accountKey)).toEqual(["a", "b", "z"]);
  });

  it("places invalid and future account times after valid reports", () => {
    const accounts = [account("a", "invalid"), account("b", "2026-08-11T12:00:00Z"), account("z")];
    expect(orderQuotaAccounts(accounts, Date.now()).map((item) => item.accountKey)).toEqual(["z", "a", "b"]);
    expect(orderQuotaAccounts(accounts.slice(0, 2).reverse(), Date.now()).map((item) => item.accountKey)).toEqual(["a", "b"]);
  });

  it("keeps old rate limits stale even when the plan has just reported", async () => {
    const snapshot = account("partial", "2026-08-10T12:00:00Z");
    snapshot.windows.push({ ...snapshot.windows[0], windowKey: "plan", rawJson: { label: "Plus" } });
    snapshot.windows[0].capturedAt = "2026-08-10T11:00:00Z";
    snapshot.windows.push({ ...snapshot.windows[0], windowKey: "rate_limit_secondary", capturedAt: "2026-08-10T11:59:00Z", utilization: 0.4 });
    setAccounts([snapshot]);

    const html = await render();
    expect(html).toContain("Awaiting refresh");
    expect(html).not.toContain("75%");
    expect(html).toContain("60%");
    expect(html.match(/style="width:/g)).toHaveLength(1);
  });

  it.each(["rate_limit_primary", "rate_limit_secondary", "code_review_rate_limit_primary", "code_review_rate_limit_secondary"])("hides the current value when %s has reset", async (windowKey) => {
    const snapshot = account("reset", "2026-08-10T12:00:00Z");
    snapshot.windows[0].windowKey = windowKey;
    snapshot.windows[0].resetsAt = "2026-08-10T12:00:00Z";
    setAccounts([snapshot]);
    const html = await render();
    expect(html).toContain("Awaiting refresh");
    expect(html).not.toContain("75%");
    expect(html).not.toContain('style="width:');
  });

  it("does not borrow an account capture time for legacy windows", async () => {
    const snapshot = account("legacy", "2026-08-10T12:00:00Z");
    const { capturedAt: _capturedAt, ...legacyWindow } = snapshot.windows[0];
    mocks.getQuotaLatest.mockResolvedValue({ byProvider: { "codex-chatgpt": { ...snapshot, windows: [legacyWindow] } } });
    const html = await render();
    expect(html).toContain("Awaiting refresh");
    expect(html).not.toContain("75%");
  });

  it.each([NaN, Infinity, -Infinity, -0.1, 1.1, null])("renders unknown instead of an invalid utilization %s", async (utilization) => {
    const snapshot = account("invalid-utilization", "2026-08-10T12:00:00Z");
    snapshot.windows[0].utilization = utilization;
    setAccounts([snapshot]);
    const html = await render();
    expect(html).toContain("Unknown");
    expect(html).not.toContain("Awaiting refresh");
    expect(html).not.toMatch(/NaN%|Infinity%|style="width:/);
  });

  it.each([{ balance: 123.45 }, { unlimited: true }])("hides stale credit values %j using the credit row's own time", async (rawJson) => {
    const snapshot = account("credit", "2026-08-10T12:00:00Z");
    snapshot.windows.push({ ...snapshot.windows[0], windowKey: "credit_balance", capturedAt: "2026-08-10T11:00:00Z", rawJson });
    setAccounts([snapshot]);
    const html = await render();
    expect(html).toContain("75%");
    expect(html).toContain("Awaiting refresh");
    expect(html).not.toContain("$123.45");
    expect(html).not.toContain("∞");
  });

  it.each([[{ balance: 123.45 }, "$123.45"], [{ unlimited: true }, "∞"]])("preserves fresh credit values %j", async (rawJson, expected) => {
    const snapshot = account("credit", "2026-08-10T12:00:00Z");
    snapshot.windows = [{ ...snapshot.windows[0], windowKey: "credit_balance", rawJson }];
    setAccounts([snapshot]);
    expect(await render()).toContain(expected);
  });

  it.each([undefined, "invalid", "2026-08-10T12:00:00.001Z"])("hides credit balances with unknown/future capture %s", async (capturedAt) => {
    const snapshot = account("credit", "2026-08-10T12:00:00Z");
    const credit = { ...snapshot.windows[0], windowKey: "credit_balance", capturedAt, rawJson: { unlimited: true } };
    mocks.getQuotaLatest.mockResolvedValue({ byProvider: { "codex-chatgpt": { ...snapshot, windows: [credit] } } });
    const html = await render();
    expect(html).toContain("Awaiting refresh");
    expect(html).not.toContain("∞");
  });

  it("ships the account label in both locales with the same placeholder", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8"));

    expect(en.subscription.codex.accountLabel).toBe("Account: {account}");
    expect(zh.subscription.codex.accountLabel).toBe("账号：{account}");
  });

  describe.each(["en", "zh-CN"])("real %s translations", (locale) => {
    beforeEach(() => {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      mocks.getLocale.mockResolvedValue(locale);
      mocks.getTranslations.mockResolvedValue(createTranslator({ locale, messages, onError: (error) => { throw error; } }));
      mocks.getUserTimezone.mockResolvedValue("Asia/Shanghai");
    });

    it("shows independent capture times, absolute reset status and the last account report", async () => {
      const snapshot = account("latest-account", "2026-08-10T12:00:00Z");
      snapshot.capturedBy = { id: "device-1", name: "Laptop" };
      const base = snapshot.windows[0];
      snapshot.windows = [
        { ...base, windowKey: "plan", rawJson: { label: "Plus" } },
        { ...base, capturedAt: "2026-08-10T11:45:00Z", resetsAt: "2026-08-10T13:00:00Z" },
        { ...base, windowKey: "rate_limit_secondary", capturedAt: "2026-08-10T11:00:00Z", resetsAt: "2026-08-10T11:30:00Z", utilization: 0.1 },
        { ...base, windowKey: "code_review_rate_limit_primary" },
        { ...base, windowKey: "code_review_rate_limit_secondary" },
        { ...base, windowKey: "credit_balance", capturedAt: "2026-08-10T11:59:00Z", rawJson: { balance: 12 } }
      ];
      setAccounts([account("older-account"), snapshot]);

      const html = await render();
      expect(html).toContain(locale === "en" ? "Aug 10, 2026" : "2026年8月10日");
      for (const clock of ["19:45:00", "19:00:00", "19:30:00", "19:59:00", "20:00:00", "21:00:00"]) {
        expect(html).toContain(clock);
      }
      expect(html).toContain("GMT+8");
      expect(html).toContain(locale === "en" ? "Last reported:" : "最近上报：");
      expect(html).toContain(locale === "en" ? "Captured:" : "采集时间：");
      expect(html).toContain(locale === "en" ? "Reported plan: Plus" : "上报套餐：Plus");
      expect(html).toContain(locale === "en" ? "Resets at:" : "重置于：");
      expect(html).toContain(locale === "en" ? "Reset time passed:" : "重置时间已过：");
      expect(html).toContain(locale === "en" ? "Other account snapshots (1)" : "其他账号快照（1）");
      expect(html).toContain("Laptop");
      expect(html).not.toContain("90%");
      expect(html).not.toMatch(/subscription\.[a-zA-Z]|relative\.[a-zA-Z]|\{(?:time|count|plan|device|account)\}|Invalid Date|NaN|ago ago|前前|前后重置|resets in/i);
    });

    it("uses the user's timezone rather than the server's timezone", async () => {
      setAccounts([account("timezone", "2026-08-10T12:00:00Z")]);
      const shanghai = await render();
      mocks.getUserTimezone.mockResolvedValue("America/Los_Angeles");
      const losAngeles = await render();
      expect(shanghai).toContain("20:00:00");
      expect(losAngeles).toContain("05:00:00");
      expect(losAngeles).not.toContain("20:00:00");
      expect(mocks.getUserTimezone).toHaveBeenCalledWith("user-1");
    });

    it("labels invalid or future time metadata as unknown without throwing", async () => {
      const snapshot = account("invalid-times", "2026-08-10T12:00:00.001Z");
      snapshot.windows[0].resetsAt = "not-a-date";
      setAccounts([snapshot]);
      const html = await render();
      expect(html).toContain(locale === "en" ? "Capture time unknown" : "采集时间未知");
      expect(html).toContain(locale === "en" ? "Reset time unknown" : "重置时间未知");
      expect(html).toContain(locale === "en" ? "Last reported: Unknown" : "最近上报：未知");
      expect(html).not.toMatch(/subscription\.|Invalid Date|NaN|75%/);
    });

    it("keeps the translated empty-state installation guidance", async () => {
      setAccounts([]);
      const html = await render();
      expect(html).toContain(locale === "en" ? "Codex CLI not detected" : "未检测到 Codex CLI");
      expect(html).not.toContain("subscription.");
    });
  });

  it("keeps all subscription keys and ICU placeholders aligned between locales", () => {
    function flatten(value: Record<string, unknown>, prefix = ""): Record<string, string> {
      return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
        const path = `${prefix}${key}`;
        return typeof entry === "string" ? [[path, entry]] : Object.entries(flatten(entry as Record<string, unknown>, `${path}.`));
      }));
    }
    const en = flatten(JSON.parse(readFileSync("messages/en.json", "utf8")).subscription);
    const zh = flatten(JSON.parse(readFileSync("messages/zh-CN.json", "utf8")).subscription);
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(en)) {
      expect(zh[key].match(/\{[^}]+\}/g)?.sort() ?? [], key).toEqual(en[key].match(/\{[^}]+\}/g)?.sort() ?? []);
    }
  });
});
