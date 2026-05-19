import { MdBolt } from "react-icons/md";
import { getTranslations } from "next-intl/server";
import Card from "@/components/card";
import { getQuotaLatest, type QuotaLatestProvider, type QuotaLatestWindow } from "@/server/quota";
import { getUserTimezone } from "@/server/timezone";
import { formatRelativeTime, formatUsd } from "@/shared/format";

export async function SubscriptionCard({ userId }: { userId: string }) {
  const t = await getTranslations();
  const tz = await getUserTimezone(userId);
  const latest = await getQuotaLatest(userId);
  const codex = latest.byProvider["codex-chatgpt"];

  if (!codex) {
    return <EmptyStateCard t={t} />;
  }
  return <ConnectedCard codex={codex} t={t} tz={tz} />;
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

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

function ConnectedCard({ codex, t, tz }: { codex: QuotaLatestProvider; t: Translator; tz: string }) {
  const planRow = codex.windows.find((w) => w.windowKey === "plan");
  const primaryRow = codex.windows.find((w) => w.windowKey === "rate_limit_primary");
  const secondaryRow = codex.windows.find((w) => w.windowKey === "rate_limit_secondary");
  const codeReviewPrimary = codex.windows.find((w) => w.windowKey === "code_review_rate_limit_primary");
  const codeReviewSecondary = codex.windows.find((w) => w.windowKey === "code_review_rate_limit_secondary");
  const creditRow = codex.windows.find((w) => w.windowKey === "credit_balance");
  const planLabel = (planRow?.rawJson as { label?: string } | null)?.label ?? "—";
  const creditRaw = creditRow?.rawJson as { balance?: number; unlimited?: boolean } | null;

  return (
    <Card extra="p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
            <MdBolt className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("subscription.codex.title")}</h3>
            {planRow && (
              <p className="text-xs text-gray-500">{t("subscription.codex.planLabel", { plan: planLabel })}</p>
            )}
          </div>
        </div>
        {creditRaw && (
          <div className="text-right">
            <div className="text-xs text-gray-500">{t("subscription.codex.creditBalance")}</div>
            <div className="text-lg font-bold text-navy-700 dark:text-white">
              {creditRaw.unlimited ? "∞" : creditRaw.balance != null ? formatUsd(creditRaw.balance) : "—"}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {primaryRow && <RateLimitRow label={t("subscription.codex.ratePrimary")} window={primaryRow} t={t} tz={tz} />}
        {secondaryRow && <RateLimitRow label={t("subscription.codex.rateSecondary")} window={secondaryRow} t={t} tz={tz} />}
        {codeReviewPrimary && <RateLimitRow label={t("subscription.codex.codeReviewPrimary")} window={codeReviewPrimary} t={t} tz={tz} />}
        {codeReviewSecondary && <RateLimitRow label={t("subscription.codex.codeReviewSecondary")} window={codeReviewSecondary} t={t} tz={tz} />}
      </div>

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        {codex.capturedBy?.name
          ? t("subscription.footer.viaDevice", { device: codex.capturedBy.name, ago: formatRelativeTime(codex.capturedAt, t, tz) })
          : t("subscription.footer.refreshed", { ago: formatRelativeTime(codex.capturedAt, t, tz) })}
      </p>
    </Card>
  );
}

function RateLimitRow({ label, window: w, t, tz }: { label: string; window: QuotaLatestWindow; t: Translator; tz: string }) {
  // Display as REMAINING capacity (matches Codex CLI's terminology). Bar
  // is full at 100% remaining and empties as the user spends quota. Color
  // thresholds invert: low remaining = danger, high remaining = healthy.
  const remaining = w.utilization != null ? Math.max(0, 100 - Math.round(w.utilization * 100)) : null;
  const barColor =
    remaining == null ? "bg-gray-200 dark:bg-white/10" :
    remaining <= 10 ? "bg-red-500" :
    remaining <= 30 ? "bg-amber-500" :
    "bg-brand-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>{label}</span>
        <span>
          {remaining != null ? `${remaining}%` : "—"}
          {w.resetsAt && (
            <span className="ml-2 text-gray-500">
              {t("subscription.codex.resetsIn", { time: formatRelativeTime(w.resetsAt, t, tz) })}
            </span>
          )}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
        <div className={`h-full ${barColor}`} style={{ width: remaining != null ? `${remaining}%` : "0%" }} />
      </div>
    </div>
  );
}
