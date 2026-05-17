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
import { MdBolt, MdInput, MdOutput, MdCached, MdDevices, MdInsights } from "react-icons/md";
import { DailyUsageChart } from "./daily-usage-chart";

export const dynamic = "force-dynamic";

type BreakdownRow = {
  name: string;
  billableTokens: number;
  events: number;
  avgBillablePerEvent: number;
};

export default async function HomePage() {
  const [summary, projects, daily, sources, models, devices] = await Promise.all([
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
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">Coding Token Usage</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Events: {formatFullNumber(summary.eventCount)} · Projects: {formatFullNumber(summary.projectCount)} · Devices: {formatFullNumber(summary.deviceCount)} · Last event: {formatDateTime(summary.lastEventAt)}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">All token figures below exclude cache reuse; cache hit rate is shown separately.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Widget
          icon={<MdBolt className="h-7 w-7" />}
          title="Total tokens"
          subtitle={formatTokens(summary.billableTokens)}
        />
        <Widget
          icon={<MdInput className="h-7 w-7" />}
          title="Input tokens"
          subtitle={formatTokens(summary.inputTokens)}
        />
        <Widget
          icon={<MdOutput className="h-7 w-7" />}
          title="Output tokens"
          subtitle={formatTokens(summary.outputTokens)}
        />
        <Widget
          icon={<MdCached className="h-7 w-7" />}
          title="Cache hit rate"
          subtitle={`${(summary.cacheHitRate * 100).toFixed(1)}%`}
        />
      </div>

      <Card extra="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">Daily Usage</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">Billable token activity stacked by direction (input + output), last {daily.length} active days, bucketed in Asia/Shanghai.</p>
          </div>
        </div>
        <div className="h-72">
          <DailyUsageChart data={daily.slice(-30)} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">Project Ranking</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-3">Project</th>
                  <th className="pb-3">Tokens</th>
                  <th className="pb-3">Share</th>
                  <th className="pb-3">Events</th>
                  <th className="pb-3">Avg / event</th>
                  <th className="pb-3">Last active</th>
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
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">Connected Clients</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-3">Client</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Tokens</th>
                  <th className="pb-3">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.deviceId} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium">{device.name}</td>
                    <td className="pr-4">
                      <ClientStatusBadge lastSeenAt={device.lastSeenAt} />
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
        <BreakdownCard title="Sources" rows={sources} billableTotal={summary.billableTokens} />
        <BreakdownCard
          title="Models"
          rows={models.map((row) => ({ ...row, name: row.name === "unknown" ? "Unknown model" : row.name }))}
          billableTotal={summary.billableTokens}
        />
      </div>

      <Card extra="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MdInsights className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">Data Quality</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <QualityMetric
            label="Unknown Project"
            value={formatTokens(summary.unknownProjectBillable)}
            helper={formatPercent(summary.unknownProjectBillable, summary.billableTokens)}
          />
          <QualityMetric
            label="Unknown Model"
            value={formatTokens(summary.unknownModelBillable)}
            helper={formatPercent(summary.unknownModelBillable, summary.billableTokens)}
          />
          <QualityMetric label="Devices" value={formatFullNumber(summary.deviceCount)} helper={devices.map((d) => d.name).join(", ") || "No devices"} />
          <QualityMetric label="Last Event" value={formatDateTime(summary.lastEventAt)} helper="Based on occurredAt" />
        </div>
      </Card>
    </div>
  );
}

function clientStatus(lastSeenAt: string | null) {
  if (!lastSeenAt) return { label: "Never seen", color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 2 * 60 * 1000) return { label: "Online", color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
  if (ageMs < 30 * 60 * 1000) return { label: "Stale", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" };
  return { label: "Offline", color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
}

function ClientStatusBadge({ lastSeenAt }: { lastSeenAt: string | null }) {
  const { label, color } = clientStatus(lastSeenAt);
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
}

function BreakdownCard({ title, rows, billableTotal }: { title: string; rows: BreakdownRow[]; billableTotal: number }) {
  return (
    <Card extra="p-6">
      <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">Name</th>
              <th className="pb-3">Tokens</th>
              <th className="pb-3">Share</th>
              <th className="pb-3">Events</th>
              <th className="pb-3">Avg / event</th>
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
