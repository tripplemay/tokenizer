import { MdBolt } from "react-icons/md";
import { getLocale, getTranslations } from "next-intl/server";
import Card from "@/components/card";
import { getQuotaLatest, type QuotaLatestProvider, type QuotaLatestWindow } from "@/server/quota";
import { getUserTimezone } from "@/server/timezone";
import { formatUsd } from "@/shared/format";
import { formatQuotaTimestamp, getQuotaFreshness, getQuotaRemaining, getQuotaWindowDuration, orderQuotaAccounts } from "@/shared/quota-presentation";

export async function SubscriptionCard({ userId }: { userId: string }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const tz = await getUserTimezone(userId);
  const latest = await getQuotaLatest(userId);
  const now = Date.now();
  const legacyCodex = latest.byProvider["codex-chatgpt"];
  const codexAccounts = orderQuotaAccounts(
    latest.accountsByProvider?.["codex-chatgpt"] ?? (legacyCodex ? [legacyCodex] : []),
    now
  );

  if (codexAccounts.length === 0) {
    return <EmptyStateCard t={t} />;
  }
  return (
    <Card extra="p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
          <MdBolt className="h-5 w-5" />
        </span>
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("subscription.codex.title")}</h3>
      </div>
      <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">{t("subscription.codex.latestSnapshot")}</p>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t("subscription.codex.windowTimesHint")}</p>
      <AccountSnapshot codex={codexAccounts[0]} t={t} tz={tz} locale={locale} now={now} />
      {codexAccounts.length > 1 && (
        <details className="mt-5 border-t border-gray-200 pt-4 dark:border-white/10">
          <summary className="cursor-pointer text-sm font-medium text-navy-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-white">
            {t("subscription.codex.otherAccounts", { count: codexAccounts.length - 1 })}
          </summary>
          <div className="mt-4 space-y-5">
            {codexAccounts.slice(1).map((codex) => (
              <AccountSnapshot key={codex.accountKey} codex={codex} t={t} tz={tz} locale={locale} now={now} />
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

type Translator = (key: string, values?: Record<string, string | number>) => string;
type SnapshotContext = { t: Translator; tz: string; locale: string; now: number };

function EmptyStateCard({ t }: { t: Translator }) {
  return (
    <Card extra="p-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
          <MdBolt className="h-5 w-5" />
        </span>
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("subscription.title")}</h3>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{t("subscription.empty.title")}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("subscription.empty.hint")}</p>
      <a
        href="https://github.com/openai/codex"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-500 hover:underline"
      >
        {t("subscription.empty.installLink")} →
      </a>
    </Card>
  );
}

function AccountSnapshot({ codex, t, tz, locale, now }: { codex: QuotaLatestProvider } & SnapshotContext) {
  const planRow = codex.windows.find((w) => w.windowKey === "plan");
  const primaryRow = codex.windows.find((w) => w.windowKey === "rate_limit_primary");
  const secondaryRow = codex.windows.find((w) => w.windowKey === "rate_limit_secondary");
  const codeReviewPrimary = codex.windows.find((w) => w.windowKey === "code_review_rate_limit_primary");
  const codeReviewSecondary = codex.windows.find((w) => w.windowKey === "code_review_rate_limit_secondary");
  const creditRow = codex.windows.find((w) => w.windowKey === "credit_balance");
  const planLabel = (planRow?.rawJson as { label?: string } | null)?.label ?? "—";
  const creditRaw = creditRow?.rawJson as { balance?: number; unlimited?: boolean } | null;
  const creditPending = getQuotaFreshness({ capturedAt: creditRow?.capturedAt }, now).pendingRefresh;
  const creditValue = creditPending ? null : creditRaw?.unlimited === true ? "∞" :
    typeof creditRaw?.balance === "number" && Number.isFinite(creditRaw.balance) && creditRaw.balance >= 0
      ? formatUsd(creditRaw.balance) : null;
  const reportedAt = getQuotaFreshness({ capturedAt: codex.capturedAt }, now).capturedAt;
  const reportedTime = reportedAt != null ? formatQuotaTimestamp(reportedAt, locale, tz) : t("subscription.codex.timeUnknown");

  return (
    <section data-account-key={codex.accountKey}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all text-xs text-gray-500">
            {t("subscription.codex.accountLabel", { account: codex.accountKey })}
          </p>
          {planRow && (
            <div className="text-xs text-gray-500" data-window-key="plan">
              <p>{t("subscription.codex.planLabel", { plan: planLabel })}</p>
              <CaptureTime window={planRow} t={t} tz={tz} locale={locale} now={now} />
            </div>
          )}
        </div>
        {creditRow && (
          <div className="text-right" data-window-key="credit_balance">
            <div className="text-xs text-gray-500">{t("subscription.codex.creditBalance")}</div>
            <div className="text-lg font-bold text-navy-700 dark:text-white">
              {creditValue ?? "—"}
            </div>
            {creditValue == null && <p className="text-xs text-gray-500">{t(creditPending ? "subscription.codex.pendingRefresh" : "subscription.codex.unknownValue")}</p>}
            <CaptureTime window={creditRow} t={t} tz={tz} locale={locale} now={now} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {primaryRow && <RateLimitRow window={primaryRow} t={t} tz={tz} locale={locale} now={now} />}
        {secondaryRow && <RateLimitRow window={secondaryRow} t={t} tz={tz} locale={locale} now={now} />}
        {codeReviewPrimary && <RateLimitRow codeReview window={codeReviewPrimary} t={t} tz={tz} locale={locale} now={now} />}
        {codeReviewSecondary && <RateLimitRow codeReview window={codeReviewSecondary} t={t} tz={tz} locale={locale} now={now} />}
      </div>

      <p className="mt-4 break-words text-xs text-gray-500 dark:text-gray-400">
        {codex.capturedBy?.name
          ? t("subscription.footer.viaDevice", { device: codex.capturedBy.name, time: reportedTime })
          : t("subscription.footer.reportedAt", { time: reportedTime })}
      </p>
    </section>
  );
}

function CaptureTime({ window, t, tz, locale, now }: { window: QuotaLatestWindow } & SnapshotContext) {
  const { capturedAt } = getQuotaFreshness({ capturedAt: window.capturedAt }, now);
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {capturedAt != null
        ? t("subscription.codex.capturedAt", { time: formatQuotaTimestamp(capturedAt, locale, tz) })
        : t("subscription.codex.captureTimeUnknown")}
    </p>
  );
}

function RateLimitRow({ codeReview = false, window: w, t, tz, locale, now }: { codeReview?: boolean; window: QuotaLatestWindow } & SnapshotContext) {
  const duration = getQuotaWindowDuration(w.rawJson);
  const period = duration == null ? t("subscription.codex.windowUnknown") :
    duration.unit === "week" && duration.value === 1 ? t("subscription.codex.windowWeekly") :
    new Intl.NumberFormat(locale, { style: "unit", unit: duration.unit, unitDisplay: "long" }).format(duration.value);
  const label = t(codeReview ? "subscription.codex.codeReviewRemaining" : "subscription.codex.rateRemaining", { window: period });
  // Display as REMAINING capacity (matches Codex CLI's terminology). Bar
  // is full at 100% remaining and empties as the user spends quota. Color
  // thresholds invert: low remaining = danger, high remaining = healthy.
  const { pendingRefresh, resetsAt } = getQuotaFreshness(w, now);
  const remaining = getQuotaRemaining(w.utilization, pendingRefresh);
  const barColor =
    remaining == null ? "bg-gray-200 dark:bg-white/10" :
    remaining <= 10 ? "bg-red-500" :
    remaining <= 30 ? "bg-amber-500" :
    "bg-brand-500";
  return (
    <div data-window-key={w.windowKey}>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <span>{label}</span>
        <span>
          {remaining != null ? `${remaining}%` : "—"}
          {remaining == null && (
            <span className="ml-2">{t(pendingRefresh ? "subscription.codex.pendingRefresh" : "subscription.codex.unknownValue")}</span>
          )}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5" aria-hidden="true">
        {remaining != null && <div className={`h-full ${barColor}`} style={{ width: `${remaining}%` }} />}
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
        <CaptureTime window={w} t={t} tz={tz} locale={locale} now={now} />
        {w.resetsAt != null && (
          <p>
            {resetsAt != null
              ? t(resetsAt <= now ? "subscription.codex.resetPassed" : "subscription.codex.resetsAt", { time: formatQuotaTimestamp(resetsAt, locale, tz) })
              : t("subscription.codex.resetTimeUnknown")}
          </p>
        )}
      </div>
    </div>
  );
}
