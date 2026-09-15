import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import type { QuotaLatestWindow } from "@/server/quota";

const mocks = vi.hoisted(() => ({
  getQuotaLatest: vi.fn(), getUserTimezone: vi.fn(),
  getLocale: vi.fn(), getTranslations: vi.fn()
}));
vi.mock("@/server/quota", () => ({ getQuotaLatest: mocks.getQuotaLatest }));
vi.mock("@/server/timezone", () => ({ getUserTimezone: mocks.getUserTimezone }));
vi.mock("next-intl/server", () => ({
  getLocale: mocks.getLocale, getTranslations: mocks.getTranslations
}));
(globalThis as Record<string, unknown>).React = React;
const { SubscriptionCard } = await import("../../app/_components/subscription-card");
const capturedAt = "2026-09-15T19:26:46.543Z";

function window(windowKey: string, rawJson: unknown): QuotaLatestWindow {
  return {
    windowKey, rawJson, capturedAt, utilization: 0.83, usedRaw: null,
    limitRaw: null, unit: "percent", resetsAt: "2026-09-19T12:21:47.000Z"
  };
}

async function render(windows: QuotaLatestWindow[]) {
  const account = { accountKey: "fixture-account", capturedAt, capturedBy: null, windows };
  mocks.getQuotaLatest.mockResolvedValue({
    byProvider: { "codex-chatgpt": account },
    accountsByProvider: { "codex-chatgpt": [account] }
  });
  return renderToStaticMarkup(await SubscriptionCard({ userId: "fixture-user" }));
}

function label(html: string, key: string) {
  return html.match(new RegExp(`data-window-key="${key}"[^>]*>[\\s\\S]*?<span>([^<]*)</span>`))?.[1];
}

describe.each(["en", "zh-CN"])("quota window labels: %s", (locale) => {
  const zh = locale === "zh-CN";
  const caption = (period: string, review = false) => zh
    ? `${review ? "代码审查" : ""}剩余额度（${period}）`
    : `${review ? "Code review remaining" : "Remaining"} (${period})`;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));
    mocks.getLocale.mockResolvedValue(locale);
    mocks.getUserTimezone.mockResolvedValue("UTC");
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
    mocks.getTranslations.mockResolvedValue(createTranslator({ locale, messages, onError: (error) => { throw error; } }));
  });
  afterEach(() => vi.useRealTimers());

  it("renders a weekly-only primary from the observed 604800-second payload", async () => {
    const html = await render([window("rate_limit_primary", {
      used_percent: 83, limit_window_seconds: 604800,
      reset_after_seconds: 320100, reset_at: 1789820507
    })]);
    expect(label(html, "rate_limit_primary")).toBe(caption(zh ? "一周" : "weekly"));
    expect(html).toContain("17%");
    expect(html).not.toContain('data-window-key="rate_limit_secondary"');
    expect(html).not.toMatch(/5小时|5h|5 hours/);
  });

  it.each([false, true])("uses durations for dual windows, swapped=%s", async (swapped) => {
    const html = await render([
      window("rate_limit_primary", { limit_window_seconds: swapped ? 604800 : 18000 }),
      window("rate_limit_secondary", { limit_window_seconds: swapped ? 18000 : 604800 })
    ]);
    const weekly = caption(zh ? "一周" : "weekly");
    const hourly = caption(zh ? "5小时" : "5 hours");
    expect(label(html, "rate_limit_primary")).toBe(swapped ? weekly : hourly);
    expect(label(html, "rate_limit_secondary")).toBe(swapped ? hourly : weekly);
  });

  it.each(["rate_limit_primary", "rate_limit_secondary", "code_review_rate_limit_primary", "code_review_rate_limit_secondary"])("handles legacy minutes for %s", async (key) => {
    const html = await render([window(key, { window_minutes: 60 })]);
    expect(label(html, key)).toBe(caption(zh ? "1小时" : "1 hour", key.startsWith("code_review")));
  });

  it.each([
    [1209600, "2 weeks", "2周"], [259200, "3 days", "3天"],
    [5400, "90 minutes", "90分钟"], [61, "61 seconds", "61秒钟"]
  ])("formats an exact %s-second duration", async (seconds, en, chinese) => {
    const html = await render([window("rate_limit_primary", { limit_window_seconds: seconds })]);
    expect(label(html, "rate_limit_primary")).toBe(caption(String(zh ? chinese : en)));
  });

  it.each([null, {}, { limit_window_seconds: -1 }, { limit_window_seconds: "604800" }, { reset_after_seconds: 18000 }])("does not guess a duration from invalid metadata %j", async (raw) => {
    const html = await render([
      window("rate_limit_primary", raw),
      window("code_review_rate_limit_secondary", raw)
    ]);
    const unknown = zh ? "周期未知" : "unknown window";
    expect(label(html, "rate_limit_primary")).toBe(caption(unknown));
    expect(label(html, "code_review_rate_limit_secondary")).toBe(caption(unknown, true));
    expect(html).toContain("17%");
  });

  it("uses seconds before conflicting legacy minutes without changing stale handling", async () => {
    const stale = window("rate_limit_primary", { limit_window_seconds: 604800, window_minutes: 300 });
    stale.capturedAt = "2026-09-15T18:00:00.000Z";
    const html = await render([stale]);
    expect(label(html, "rate_limit_primary")).toBe(caption(zh ? "一周" : "weekly"));
    expect(html).not.toContain("17%");
    expect(html).toContain(zh ? "待刷新" : "Awaiting refresh");
  });
});
