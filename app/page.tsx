import { getTranslations } from "next-intl/server";
import { MdInput, MdOutput, MdCached, MdSpeed, MdSave, MdDevices, MdInsights } from "react-icons/md";
import {
  getBreakdown,
  getDailySummary,
  getDeviceSummary,
  getProjectSummary,
  getSummary
} from "@/server/summaries";
import { formatDateTime, formatFullNumber, formatPercent, formatTokens } from "@/shared/format";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { DailyUsageChart } from "./daily-usage-chart";

export const dynamic = "force-dynamic";

type BreakdownRow = {
  name: string;
  billableTokens: number;
  events: number;
  avgBillablePerEvent: number;
};

export default async function HomePage() {
  const [t, summary, projects, daily, sources, models, devices] = await Promise.all([
    getTranslations(),
    getSummary(),
    getProjectSummary(),
    getDailySummary(),
    getBreakdown("source"),
    getBreakdown("model"),
    getDeviceSummary()
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("home.title")}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("home.meta", {
            events: formatFullNumber(summary.eventCount),
            projects: formatFullNumber(summary.projectCount),
            devices: formatFullNumber(summary.deviceCount),
            lastEvent: formatDateTime(summary.lastEventAt)
          })}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">{t("timezone.note")}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-5">
        <div title={t("home.kpi.inputHint")}>
          <Widget icon={<MdInput className="h-7 w-7" />} title={t("home.kpi.inputTokens")} subtitle={formatTokens(summary.inputTokens)} />
        </div>
        <div title={t("home.kpi.cacheWriteHint")}>
          <Widget icon={<MdSave className="h-7 w-7" />} title={t("home.kpi.cacheWrite")} subtitle={formatTokens(summary.cacheWriteTokens)} />
        </div>
        <div title={t("home.kpi.cacheReuseHint")}>
          <Widget icon={<MdCached className="h-7 w-7" />} title={t("home.kpi.cacheReuse")} subtitle={formatTokens(summary.cachedInputTokens)} />
        </div>
        <div title={t("home.kpi.outputHint", { reasoning: formatTokens(summary.reasoningOutputTokens) })}>
          <Widget icon={<MdOutput className="h-7 w-7" />} title={t("home.kpi.outputTokens")} subtitle={formatTokens(summary.outputTokens)} />
        </div>
        <div title={t("home.kpi.cacheReused", { tokens: formatFullNumber(summary.cachedInputTokens) })}>
          <Widget icon={<MdSpeed className="h-7 w-7" />} title={t("home.kpi.cacheHitRate")} subtitle={`${(summary.cacheHitRate * 100).toFixed(1)}%`} />
        </div>
      </div>

      <Card extra="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.daily.title")}</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t("home.daily.subtitle", { days: daily.length })}</p>
          </div>
        </div>
        <div className="h-72">
          <DailyUsageChart data={daily.slice(-30)} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("home.projectRanking.title")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-3">{t("home.projectRanking.col.project")}</th>
                  <th className="pb-3">{t("home.projectRanking.col.tokens")}</th>
                  <th className="pb-3">{t("home.projectRanking.col.share")}</th>
                  <th className="pb-3">{t("home.projectRanking.col.events")}</th>
                  <th className="pb-3">{t("home.projectRanking.col.avgPerEvent")}</th>
                  <th className="pb-3">{t("home.projectRanking.col.lastActive")}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.projectId ?? project.name} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                    <td className="py-2.5 pr-4">
                      <a className="font-medium hover:underline" href={project.projectId ? `/projects/${project.projectId}` : "#"}>
                        {project.name}
                      </a>
                    </td>
                    <td className="pr-4" title={`${formatFullNumber(project.billableTokens)} billable tokens`}>{formatTokens(project.billableTokens)}</td>
                    <td className="pr-4">{formatPercent(project.billableTokens, summary.billableTokens)}</td>
                    <td className="pr-4">{formatFullNumber(project.events)}</td>
                    <td className="pr-4">{formatTokens(project.avgBillablePerEvent)}</td>
                    <td className="whitespace-nowrap text-gray-500">{formatDateTime(project.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card extra="p-6">
          <div className="mb-4 flex items-center gap-2">
            <MdDevices className="h-5 w-5 text-brand-500" />
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.connectedClients.title")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-3">{t("home.connectedClients.col.client")}</th>
                  <th className="pb-3">{t("home.connectedClients.col.status")}</th>
                  <th className="pb-3">{t("home.connectedClients.col.tokens")}</th>
                  <th className="pb-3">{t("home.connectedClients.col.lastSeen")}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.deviceId} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium">{device.name}</td>
                    <td className="pr-4">
                      <ClientStatusBadge lastSeenAt={device.lastSeenAt} t={t} />
                    </td>
                    <td className="pr-4" title={`${formatFullNumber(device.billableTokens)} billable tokens`}>{formatTokens(device.billableTokens)}</td>
                    <td className="pr-4 whitespace-nowrap text-gray-500">{formatDateTime(device.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <BreakdownCard
          title={t("home.breakdown.sources")}
          rows={sources}
          billableTotal={summary.billableTokens}
          col={{
            name: t("home.breakdown.col.name"),
            tokens: t("home.breakdown.col.tokens"),
            share: t("home.breakdown.col.share"),
            events: t("home.breakdown.col.events"),
            avgPerEvent: t("home.breakdown.col.avgPerEvent")
          }}
        />
        <BreakdownCard
          title={t("home.breakdown.models")}
          rows={models.map((row) => ({ ...row, name: row.name === "unknown" ? t("home.unknownModel") : row.name }))}
          billableTotal={summary.billableTokens}
          col={{
            name: t("home.breakdown.col.name"),
            tokens: t("home.breakdown.col.tokens"),
            share: t("home.breakdown.col.share"),
            events: t("home.breakdown.col.events"),
            avgPerEvent: t("home.breakdown.col.avgPerEvent")
          }}
        />
      </div>

      <Card extra="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MdInsights className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.dataQuality.title")}</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <QualityMetric
            label={t("home.dataQuality.unknownProject")}
            value={formatTokens(summary.unknownProjectBillable)}
            helper={formatPercent(summary.unknownProjectBillable, summary.billableTokens)}
          />
          <QualityMetric
            label={t("home.dataQuality.unknownModel")}
            value={formatTokens(summary.unknownModelBillable)}
            helper={formatPercent(summary.unknownModelBillable, summary.billableTokens)}
          />
          <QualityMetric
            label={t("home.dataQuality.reasoningTokens")}
            value={formatTokens(summary.reasoningOutputTokens)}
            helper={t("home.dataQuality.reasoningHelper", { percent: formatPercent(summary.reasoningOutputTokens, summary.outputTokens) })}
          />
          <QualityMetric label={t("home.dataQuality.devices")} value={formatFullNumber(summary.deviceCount)} helper={devices.map((d) => d.name).join(", ") || t("home.dataQuality.noDevices")} />
          <QualityMetric label={t("home.dataQuality.lastEvent")} value={formatDateTime(summary.lastEventAt)} helper={t("home.dataQuality.lastEventHelper")} />
        </div>
      </Card>
    </div>
  );
}

function clientStatus(lastSeenAt: string | null) {
  if (!lastSeenAt) return { key: "neverSeen" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 2 * 60 * 1000) return { key: "online" as const, color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
  if (ageMs < 30 * 60 * 1000) return { key: "stale" as const, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" };
  return { key: "offline" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
}

function ClientStatusBadge({ lastSeenAt, t }: { lastSeenAt: string | null; t: (k: string) => string }) {
  const { key, color } = clientStatus(lastSeenAt);
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{t(`clientStatus.${key}`)}</span>;
}

function BreakdownCard({ title, rows, billableTotal, col }: { title: string; rows: BreakdownRow[]; billableTotal: number; col: { name: string; tokens: string; share: string; events: string; avgPerEvent: string } }) {
  return (
    <Card extra="p-6">
      <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">{col.name}</th>
              <th className="pb-3">{col.tokens}</th>
              <th className="pb-3">{col.share}</th>
              <th className="pb-3">{col.events}</th>
              <th className="pb-3">{col.avgPerEvent}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                <td className="py-2.5 pr-4 font-medium">{row.name}</td>
                <td className="pr-4" title={`${formatFullNumber(row.billableTokens)} billable tokens`}>{formatTokens(row.billableTokens)}</td>
                <td className="pr-4">{formatPercent(row.billableTokens, billableTotal)}</td>
                <td className="pr-4">{formatFullNumber(row.events)}</td>
                <td className="pr-4">{formatTokens(row.avgBillablePerEvent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function QualityMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white/40 p-4 dark:border-white/10 dark:bg-navy-900/40">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1.5 truncate text-xl font-bold text-navy-700 dark:text-white">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{helper}</div>
    </div>
  );
}
