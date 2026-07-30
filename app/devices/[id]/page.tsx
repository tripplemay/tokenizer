import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MdArrowBack, MdBolt, MdCached, MdComputer, MdPaid, MdSpeed } from "react-icons/md";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { getDailyForDevice, getDeviceDetail } from "@/server/summaries";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
import type { RangeOption } from "@/server/summaries";
import { formatDateTimeSeconds, formatFullNumber, formatPercent, formatRelativeTime, formatTokens, formatUsd } from "@/shared/format";
import { deviceStatusBadge } from "@/shared/device-status";
import { AutoRefresh } from "../../_components/auto-refresh";
import { DailyUsageChart } from "../../daily-usage-chart";
import { ProjectIcon } from "../../_components/project-icon";
import { SourcePill } from "../../_components/source-pill";
import { ModelLink } from "../../_components/model-link";
import { PageBanner } from "../../_components/page-banner";
import { HarnessHealthBadge, type HarnessHealthLabels } from "../../_components/harness-health-badge";
import { harnessSnapshotFromPersisted } from "@/shared/harness-health";

export const dynamic = "force-dynamic";

function parseRange(raw: unknown): RangeOption {
  if (raw === "7d" || raw === "30d") return raw;
  return "all";
}

function DiagItem({ label, value, valueClass, mono, wrap }: { label: string; value: string; valueClass?: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white/40 p-4 dark:border-white/10 dark:bg-navy-900/40">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1.5 ${wrap ? "break-words" : "truncate"} text-sm font-semibold text-navy-700 dark:text-white ${mono ? "font-mono" : ""} ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}

function DeviceRangeSelector({
  deviceId,
  current,
  labels
}: {
  deviceId: string;
  current: RangeOption;
  labels: { sevenDay: string; thirtyDay: string; all: string };
}) {
  const buildHref = (next: RangeOption): string => {
    const params = new URLSearchParams();
    if (next !== "all") params.set("range", next);
    const qs = params.toString();
    return qs ? `/devices/${deviceId}?${qs}` : `/devices/${deviceId}`;
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

export default async function DeviceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const session = await requireSession();
  const tenantId = session.user.id;
  const tz = await getUserTimezone(tenantId);
  const [t, detail, daily] = await Promise.all([
    getTranslations(),
    getDeviceDetail(tenantId, id, range),
    getDailyForDevice(tenantId, id, range, tz)
  ]);

  const tRelative = t as (key: string, values?: Record<string, string | number>) => string;

  if (!detail.device) {
    return (
      <div className="space-y-5">
        <Link href="/devices" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          {t("device.back")}
        </Link>
        <Card extra="p-6">
          <p className="text-navy-700 dark:text-white">{t("device.notFound")}</p>
        </Card>
      </div>
    );
  }

  const { device, totals, events, byProject, byModel, bySource } = detail;
  const { key: statusKey, color: statusColor } = deviceStatusBadge(device.lastSeenAt?.toISOString() ?? null, Date.now());
  const harness = harnessSnapshotFromPersisted(
    device.lastHarnessSyncAt,
    device.harnessSyncStatus,
    device.harnessDiagnostics
  );
  const harnessLabels: HarnessHealthLabels = {
    idle: t("device.diagnostics.harness.status.idle"),
    success: t("device.diagnostics.harness.status.success"),
    degraded: t("device.diagnostics.harness.status.degraded"),
    failed: t("device.diagnostics.harness.status.failed"),
    stale: t("device.diagnostics.harness.status.stale"),
    "not-reported": t("device.diagnostics.harness.status.notReported")
  };

  return (
    <div className="space-y-5">
      {/* Keep device status/metrics live without a manual reload. */}
      <AutoRefresh />
      <PageBanner
        overline={
          <Link href="/devices" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
            <MdArrowBack className="h-4 w-4" />
            {t("device.back")}
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <MdComputer className="h-6 w-6 text-brand-500" />
            {device.name}
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>{t(`clientStatus.${statusKey}`)}</span>
          </span>
        }
        subtitle={
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{t("device.meta.hostname", { value: device.hostname ?? "—" })}</span>
            <span>{t("device.meta.platform", { value: device.platform ?? "—" })}</span>
            <span>{t("device.meta.lastSeen", { value: formatRelativeTime(device.lastSeenAt?.toISOString() ?? null, tRelative, tz) })}</span>
            <span>{t("device.meta.lastSync", { value: formatRelativeTime(device.lastSyncAt?.toISOString() ?? null, tRelative, tz) })}</span>
          </div>
        }
        rightSlot={
          <DeviceRangeSelector
            deviceId={id}
            current={range}
            labels={{
              sevenDay: t("home.range.sevenDay"),
              thirtyDay: t("home.range.thirtyDay"),
              all: t("home.range.all")
            }}
          />
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Widget icon={<MdBolt className="h-7 w-7" />} title={t("device.metric.compute")} subtitle={formatTokens(totals.billableTokens)} />
        <Widget icon={<MdPaid className="h-7 w-7" />} title={t("device.metric.cost")} subtitle={totals.cost > 0 ? formatUsd(totals.cost) : "—"} />
        <Widget icon={<MdSpeed className="h-7 w-7" />} title={t("device.metric.cacheHit")} subtitle={`${(totals.cacheHitRate * 100).toFixed(1)}%`} />
        <Widget icon={<MdCached className="h-7 w-7" />} title={t("device.metric.events")} subtitle={formatFullNumber(totals.eventCount)} />
      </div>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("device.diagnostics.title")}</h3>
        <div className="grid gap-4 md:grid-cols-4">
          <DiagItem label={t("device.diagnostics.agentVersion")} value={device.agentVersion ?? "—"} mono />
          <DiagItem
            label={t("device.diagnostics.queueDepth")}
            value={device.queueDepth == null ? "—" : String(device.queueDepth)}
            valueClass={device.queueDepth && device.queueDepth > 0 ? "text-yellow-600 dark:text-yellow-400" : undefined}
          />
          <DiagItem
            label={t("device.diagnostics.lastSyncStatus")}
            value={device.lastSyncStatus ? t(`device.diagnostics.status.${device.lastSyncStatus}`) : "—"}
            valueClass={device.lastSyncStatus === "failed" ? "text-red-600 dark:text-red-400" : device.lastSyncStatus === "success" ? "text-green-600 dark:text-green-400" : undefined}
          />
          <DiagItem
            label={t("device.diagnostics.lastError")}
            value={device.lastError ?? "—"}
            valueClass={device.lastError ? "text-red-600 dark:text-red-400" : undefined}
            wrap
          />
        </div>

        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-navy-700 dark:text-white">
              {t("device.diagnostics.harness.title")}
            </h4>
            <HarnessHealthBadge
              status={device.harnessSyncStatus}
              attemptedAt={device.lastHarnessSyncAt}
              nowMs={Date.now()}
              labels={harnessLabels}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {device.lastHarnessSyncAt
                ? formatRelativeTime(device.lastHarnessSyncAt, tRelative, tz)
                : t("device.diagnostics.harness.never")}
            </span>
          </div>
          {harness ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <DiagItem label={t("device.diagnostics.harness.reported")} value={String(harness.reported)} />
                <DiagItem label={t("device.diagnostics.harness.failedProjects")} value={String(harness.failed)} />
                <DiagItem label={t("device.diagnostics.harness.relayed")} value={String(harness.relayed)} />
                <DiagItem label={t("device.diagnostics.harness.modeIntents")} value={String(harness.modeIntents)} />
              </div>
              {harness.issues.length > 0 ? (
                <div className="mt-5">
                  <h5 className="text-xs font-bold uppercase text-gray-500">
                    {t("device.diagnostics.harness.issues", { count: harness.issues.length })}
                  </h5>
                  <ul className="mt-2 divide-y divide-gray-200 dark:divide-white/10">
                    {harness.issues.map((issue, index) => (
                      <li
                        key={`${issue.operation}-${issue.project ?? "none"}-${issue.code}-${index}`}
                        className="grid min-w-0 gap-1 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
                      >
                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-200">
                          {issue.project ?? t("device.diagnostics.harness.unknownProject")} · {t(`device.diagnostics.harness.operation.${issue.operation}`)} ·{" "}
                          <span className="break-all font-mono">{issue.code}</span>
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {issue.retryable
                            ? t("device.diagnostics.harness.retryable")
                            : t("device.diagnostics.harness.notRetryable")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>

      <Card extra="p-6">
        <div className="mb-3">
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("device.daily.title")}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("device.daily.subtitle", { days: daily.length })}</p>
        </div>
        <div className="h-72">
          <DailyUsageChart data={daily} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("device.projects.title")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("device.col.project")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {byProject.map((row) => (
                <tr key={row.projectId ?? row.name} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <ProjectIcon repoKey={row.repoKey} workspacePath={row.workspacePath} folderTitle={t("project.localFolderTooltip")} />
                      <Link href={row.projectId ? `/projects/${row.projectId}` : "#"} className="font-medium hover:underline">{row.name}</Link>
                    </div>
                  </td>
                  <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                  <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                  <td className="pr-4 text-right">{row.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("device.models.title")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("device.col.model")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.total")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.share")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => (
                <tr key={row.model ?? "unknown"} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 font-medium"><ModelLink model={row.model} fallback={t("device.unknownModel")} /></td>
                  <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                  <td className="pr-4 text-right text-gray-500">{formatTokens(row.inputTokens + row.outputTokens)}</td>
                  <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                  <td className="pr-4 text-right">{formatPercent(row.billableTokens, totals.billableTokens)}</td>
                  <td className="pr-4 text-right">{row.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("device.sources.title")}</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">{t("device.col.source")}</th>
              <th className="pb-3 pr-4 text-right">{t("device.col.compute")}</th>
              <th className="pb-3 pr-4 text-right">{t("device.col.cost")}</th>
              <th className="pb-3 pr-4 text-right">{t("device.col.events")}</th>
              <th className="pb-3 pr-4 text-right">{t("device.col.share")}</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map((row) => (
              <tr key={row.source} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                <td className="py-2.5 pr-4"><SourcePill source={row.source} /></td>
                <td className="pr-4 text-right">{formatTokens(row.billableTokens)}</td>
                <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                <td className="pr-4 text-right">{row.events}</td>
                <td className="pr-4 text-right">{formatPercent(row.billableTokens, totals.billableTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("device.recentEvents")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("device.col.time")}</th>
                <th className="pb-3">{t("device.col.project")}</th>
                <th className="pb-3">{t("device.col.source")}</th>
                <th className="pb-3">{t("device.col.model")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.input")}</th>
                <th className="pb-3 pr-4 text-right">{t("device.col.output")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTimeSeconds(event.occurredAt, tz)}</td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{event.workspacePath ? event.workspacePath.split("/").filter(Boolean).at(-1) : "—"}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300"><ModelLink model={event.model} fallback={t("device.unknownModel")} /></td>
                  <td className="py-2.5 pr-4 text-right">{formatFullNumber(event.inputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatFullNumber(event.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
