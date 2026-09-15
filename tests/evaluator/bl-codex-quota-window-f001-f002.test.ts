/**
 * Independent evaluator probes for BL-CODEX-QUOTA-WINDOW (F001).
 * Written from docs/specs/BL-CODEX-QUOTA-WINDOW-spec.md without reusing
 * generator fixtures: duration parsing edges, position-independence,
 * code-review windows, DOM preservation and i18n parity of the new keys.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import type { QuotaLatestWindow } from "@/server/quota";
import { getQuotaWindowDuration } from "@/shared/quota-presentation";

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
    windowKey, rawJson, capturedAt, utilization: 0.4, usedRaw: null,
    limitRaw: null, unit: "percent", resetsAt: "2026-09-19T12:21:47.000Z"
  };
}

async function render(windows: QuotaLatestWindow[], locale: string) {
  const account = { accountKey: "eval-probe", capturedAt, capturedBy: null, windows };
  mocks.getQuotaLatest.mockResolvedValue({
    byProvider: { "codex-chatgpt": account },
    accountsByProvider: { "codex-chatgpt": [account] }
  });
  mocks.getLocale.mockResolvedValue(locale);
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  mocks.getTranslations.mockResolvedValue(createTranslator({ locale, messages, onError: (e) => { throw e; } }));
  return renderToStaticMarkup(await SubscriptionCard({ userId: "eval-user" }));
}

describe("evaluator probe: getQuotaWindowDuration contract edges", () => {
  it.each([
    [{ limit_window_seconds: 18000.5 }, null],
    [{ limit_window_seconds: 604799 }, { unit: "second", value: 604799 }],
    [{ limit_window_seconds: Number.MAX_SAFE_INTEGER }, { unit: "second", value: Number.MAX_SAFE_INTEGER }],
    [{ window_minutes: 0.1 }, { unit: "second", value: 6 }],
    [{ window_minutes: 1 / 3 }, { unit: "second", value: 20 }],
    [{ window_minutes: 0.07 }, null],
    [{ window_minutes: true }, null],
    [{ limit_window_seconds: 86400, window_minutes: "junk" }, { unit: "day", value: 1 }],
    [{ limit_window_seconds: 172800 }, { unit: "day", value: 2 }]
  ] as const)("maps %j", (rawJson, expected) => {
    expect(getQuotaWindowDuration(rawJson)).toEqual(expected);
  });

  it("rejects non-object rawJson shapes", () => {
    for (const raw of [() => 604800, new Date(), 604800n] as unknown[]) {
      expect(getQuotaWindowDuration(raw)).toBeNull();
    }
  });
});

describe.each(["en", "zh-CN"])("evaluator probe: rendered labels (%s)", (locale) => {
  const zh = locale === "zh-CN";
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));
    mocks.getUserTimezone.mockResolvedValue("UTC");
  });
  afterEach(() => vi.useRealTimers());

  function label(html: string, key: string) {
    return html.match(new RegExp(`data-window-key="${key}"[^>]*>[\\s\\S]*?<span>([^<]*)</span>`))?.[1];
  }

  it("labels a code-review-only weekly window from its own duration", async () => {
    const html = await render([window("code_review_rate_limit_primary", { limit_window_seconds: 604800 })], locale);
    expect(label(html, "code_review_rate_limit_primary")).toBe(zh ? "代码审查剩余额度（一周）" : "Code review remaining (weekly)");
  });

  it("never infers weekly from the secondary position when metadata is invalid", async () => {
    const html = await render([
      window("rate_limit_primary", { limit_window_seconds: 18000 }),
      window("rate_limit_secondary", { window_minutes: -5 })
    ], locale);
    expect(label(html, "rate_limit_primary")).toBe(zh ? "剩余额度（5小时）" : "Remaining (5 hours)");
    expect(label(html, "rate_limit_secondary")).toBe(zh ? "剩余额度（周期未知）" : "Remaining (unknown window)");
  });

  it("renders day-scale durations without rounding and keeps bar, percentage and reset row", async () => {
    const html = await render([window("rate_limit_primary", { limit_window_seconds: 86400 })], locale);
    expect(label(html, "rate_limit_primary")).toBe(zh ? "剩余额度（1天）" : "Remaining (1 day)");
    expect(html).toContain("60%");
    expect(html).toContain("h-2 w-full overflow-hidden rounded-full");
    expect(html).toContain(zh ? "重置于：" : "Resets at:");
    expect(html).toContain(zh ? "采集时间：" : "Captured:");
  });

  it("keeps account grouping order and multi-window rows intact", async () => {
    const html = await render([
      window("rate_limit_primary", { limit_window_seconds: 18000 }),
      window("rate_limit_secondary", { limit_window_seconds: 604800 }),
      window("code_review_rate_limit_primary", { limit_window_seconds: 3600 }),
      window("code_review_rate_limit_secondary", { window_minutes: 10080 })
    ], locale);
    const order = ["rate_limit_primary", "rate_limit_secondary", "code_review_rate_limit_primary", "code_review_rate_limit_secondary"];
    const positions = order.map((k) => html.indexOf(`data-window-key="${k}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(label(html, "code_review_rate_limit_primary")).toBe(zh ? "代码审查剩余额度（1小时）" : "Code review remaining (1 hour)");
    expect(label(html, "code_review_rate_limit_secondary")).toBe(zh ? "代码审查剩余额度（一周）" : "Code review remaining (weekly)");
  });
});

describe("evaluator probe: i18n parity of the new keys", () => {
  it("en and zh-CN define matching keys and {window} placeholders", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8")).subscription.codex;
    const zh = JSON.parse(readFileSync("messages/zh-CN.json", "utf8")).subscription.codex;
    for (const key of ["rateRemaining", "codeReviewRemaining"]) {
      expect(en[key]).toContain("{window}");
      expect(zh[key]).toContain("{window}");
    }
    expect(en.windowWeekly).toBeTruthy();
    expect(zh.windowWeekly).toBeTruthy();
    expect(en.windowUnknown).toBeTruthy();
    expect(zh.windowUnknown).toBeTruthy();
    expect(en.windowUnknown).not.toBe(en.windowWeekly);
    for (const removed of ["ratePrimary", "rateSecondary", "codeReviewPrimary", "codeReviewSecondary"]) {
      expect(en[removed]).toBeUndefined();
      expect(zh[removed]).toBeUndefined();
    }
  });
});
