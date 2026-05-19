import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MdComputer, MdInventory2, MdWarning } from "react-icons/md";
import Card from "@/components/card";
import { getDailyByDevice, getDeviceSummary } from "@/server/summaries";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
import type { RangeOption } from "@/server/summaries";
import { formatFullNumber, formatRelativeTime, formatTokens, formatUsd } from "@/shared/format";
import { INSTALL_COMMAND, isDeviceOutdated } from "@/server/agent-version";
import { DailyDeviceCostChart } from "./daily-device-cost-chart";
import { AddDeviceSection } from "../_components/add-device-section";
import { CopyInstallCommand } from "../_components/copy-install-command";
import { OutdatedBadge } from "../_components/outdated-badge";
import { PageBanner } from "../_components/page-banner";

export const dynamic = "force-dynamic";

function parseRange(raw: unknown): RangeOption {
  if (raw === "7d" || raw === "30d") return raw;
  return "all";
}

function DevicesRangeSelector({
  current,
  searchParams,
  labels
}: {
  current: RangeOption;
  searchParams: Record<string, string | string[] | undefined>;
  labels: { sevenDay: string; thirtyDay: string; all: string };
}) {
  const buildHref = (next: RangeOption): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "range" || value === undefined) continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (v != null) params.set(key, v);
    }
    if (next !== "all") params.set("range", next);
    const qs = params.toString();
    return qs ? `/devices?${qs}` : "/devices";
  };
  const options: Array<{ value: RangeOption; label: string }> = [
    { value: "7d", label: labels.sevenDay },
    { value: "30d", label: labels.thirtyDay },
    { value: "all", label: labels.all }
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 p-1 dark:bg-navy-800">
      {options.map((opt) => {
        const active = current === opt.value;
        return (
          <Link
            key={opt.value}
            href={buildHref(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-navy-700 shadow-sm dark:bg-navy-700 dark:text-white"
                : "text-gray-600 hover:text-navy-700 dark:text-gray-400 dark:hover:text-white"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const session = await requireSession();
  const tenantId = session.user.id;
  const tz = await getUserTimezone(tenantId);
  const [t, currentDevices] = await Promise.all([getTranslations(), getDeviceSummary(tenantId, "all")]);

  return (
    <div className="space-y-5">
      <PageBanner
        title={t("devices.title")}
        subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("devices.subtitle")}</p>}
        note={<p className="mt-0.5 text-xs text-gray-500">{t("timezone.note", { tz })}</p>}
        rightSlot={
          <div className="flex flex-wrap items-center gap-3">
            <AddDeviceSection initialDeviceIds={currentDevices.map((d) => d.deviceId)} />
            <DevicesRangeSelector
              current={range}
              searchParams={params}
              labels={{
                sevenDay: t("home.range.sevenDay"),
                thirtyDay: t("home.range.thirtyDay"),
                all: t("home.range.all")
              }}
            />
          </div>
        }
      />

      <Card extra="p-6">
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">
          {t("devices.upgrade.title")}
        </h3>
        <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
          {t("devices.upgrade.subtitle")}
        </p>
        <CopyInstallCommand command={INSTALL_COMMAND} variant="card" />
      </Card>

      <Suspense fallback={<ChartCardSkeleton heightClass="h-72" />}>
        <DailyByDeviceSection range={range} tz={tz} />
      </Suspense>

      <Suspense fallback={<DevicesTableSkeleton />}>
        <DevicesTableSection range={range} tz={tz} />
      </Suspense>
    </div>
  );
}

async function DailyByDeviceSection({ range, tz }: { range: RangeOption; tz: string }) {
  const session = await requireSession();
  const tenantId = session.user.id;
  const [t, dailyByDevice] = await Promise.all([getTranslations(), getDailyByDevice(tenantId, range, tz)]);
  return (
    <Card extra="p-6">
      <div className="mb-3">
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("devices.dailyByDevice.title")}</h3>
        <p className="text-xs text-gray-600 dark:text-gray-400">{t("devices.dailyByDevice.subtitle")}</p>
      </div>
      <div className="h-72">
        <DailyDeviceCostChart dates={dailyByDevice.dates} series={dailyByDevice.series} />
      </div>
    </Card>
  );
}

async function DevicesTableSection({ range, tz }: { range: RangeOption; tz: string }) {
  const session = await requireSession();
  const tenantId = session.user.id;
  const [t, devices] = await Promise.all([getTranslations(), getDeviceSummary(tenantId, range)]);
  const tRelative = t as (key: string, values?: Record<string, string | number>) => string;
  return (
    <Card extra="p-6">
      <div className="mb-4 flex items-center gap-2">
        <MdComputer className="h-5 w-5 text-brand-500" />
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("devices.count", { count: devices.length })}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">{t("devices.col.name")}</th>
              <th className="pb-3">{t("devices.col.status")}</th>
              <th className="pb-3">{t("devices.col.platform")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.tokens")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.total")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.cost")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.cacheHit")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.events")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.diagnostics")}</th>
              <th className="pb-3 pr-4 text-right">{t("devices.col.lastSeen")}</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const { key, color } = deviceStatusKey(device.lastSeenAt);
              return (
                <tr key={device.deviceId} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4">
                    <Link href={`/devices/${device.deviceId}`} className="font-medium hover:underline">
                      {device.name}
                    </Link>
                    {device.hostname && device.hostname !== device.name ? (
                      <div className="text-xs text-gray-500">{device.hostname}</div>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
                        {t(`clientStatus.${key}`)}
                      </span>
                      {isDeviceOutdated(device.agentVersion) && (
                        <OutdatedBadge agentVersion={device.agentVersion} />
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{device.platform ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-right" title={`${formatFullNumber(device.billableTokens)} billable tokens`}>{formatTokens(device.billableTokens)}</td>
                  <td className="py-2.5 pr-4 text-right text-gray-500" title={`${formatFullNumber(device.totalTokens)} total tokens`}>{formatTokens(device.totalTokens)}</td>
                  <td className="py-2.5 pr-4 text-right font-medium">{device.cost > 0 ? formatUsd(device.cost) : "—"}</td>
                  <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-300">{(device.cacheHitRate * 100).toFixed(1)}%</td>
                  <td className="py-2.5 pr-4 text-right">{formatFullNumber(device.events)}</td>
                  <td className="py-2.5 pr-4 text-right">
                    <DiagnosticsBadges device={device} reportedNoData={t("devices.diag.notReported")} queueLabel={t("devices.diag.queued")} errorLabel={t("devices.diag.lastError")} />
                  </td>
                  <td className="py-2.5 pr-4 text-right whitespace-nowrap text-gray-500">{formatRelativeTime(device.lastSeenAt, tRelative, tz)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Skeletons -----------------------------------------------------------

function ChartCardSkeleton({ heightClass = "h-72" }: { heightClass?: string }) {
  return (
    <Card extra="p-6">
      <div className="mb-4 h-5 w-44 rounded bg-gray-100 dark:bg-white/10" />
      <div className={`${heightClass} animate-pulse rounded-xl bg-gray-100 dark:bg-white/5`} />
    </Card>
  );
}

function DevicesTableSkeleton() {
  return (
    <Card extra="p-6">
      <div className="mb-4 h-5 w-32 rounded bg-gray-100 dark:bg-white/10" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-7 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
        ))}
      </div>
    </Card>
  );
}

// ---- Diagnostics presentational helpers ----------------------------------

type DiagnosticsDevice = {
  agentVersion: string | null;
  queueDepth: number | null;
  lastError: string | null;
  lastSyncStatus: string | null;
};

function DiagnosticsBadges({
  device,
  reportedNoData,
  queueLabel,
  errorLabel
}: {
  device: DiagnosticsDevice;
  reportedNoData: string;
  queueLabel: string;
  errorLabel: string;
}) {
  const nothing = device.agentVersion == null && device.queueDepth == null && device.lastError == null;
  if (nothing) {
    return <span className="text-xs text-gray-400" title="Diagnostics will populate once the device upgrades to the agent build that pushes them.">{reportedNoData}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {device.lastError ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300" title={`${errorLabel}: ${device.lastError}`}>
          <MdWarning className="h-3 w-3" />
          {errorLabel}
        </span>
      ) : null}
      {device.queueDepth != null && device.queueDepth > 0 ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300" title={`${queueLabel}: ${device.queueDepth}`}>
          <MdInventory2 className="h-3 w-3" />
          {device.queueDepth}
        </span>
      ) : null}
      {device.agentVersion ? (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-white/10 dark:text-gray-300" title={`agent ${device.agentVersion}`}>{device.agentVersion.slice(0, 7)}</span>
      ) : null}
    </span>
  );
}

function deviceStatusKey(lastSeenAt: string | null) {
  // See app/page.tsx for the rationale: thresholds match the default 15-min
  // cron sync cadence so cron-mode clients aren't flagged Stale immediately.
  if (!lastSeenAt) return { key: "neverSeen" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 20 * 60 * 1000) return { key: "online" as const, color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
  if (ageMs < 60 * 60 * 1000) return { key: "stale" as const, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" };
  return { key: "offline" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
}
