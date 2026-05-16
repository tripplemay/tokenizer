import { getBreakdown, getDailySummary, getDeviceSummary, getProjectSummary, getSummary } from "@/server/summaries";
import { formatDateTime, formatFullNumber, formatPercent, formatTokens } from "@/shared/format";
import { ClientSetup } from "./client-setup";

export const dynamic = "force-dynamic";

type BreakdownRow = {
  name: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  billableTokens: number;
  events: number;
  avgTokensPerEvent: number;
  avgBillablePerEvent: number;
};

function TokenCard({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/20" title={`${formatFullNumber(value)} tokens`}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{formatTokens(value)}</div>
      <div className="mt-2 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

export default async function HomePage() {
  const [summary, projects, daily, sources, models, devices] = await Promise.all([
    getSummary(),
    getProjectSummary(),
    getDailySummary(),
    getBreakdown("source"),
    getBreakdown("model"),
    getDeviceSummary()
  ]);

  const maxDailyBillable = Math.max(...daily.map((day) => day.billableTokens), 1);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-4xl font-semibold">Coding Token Usage</h1>
        <p className="mt-2 text-slate-400">Aggregated token usage from Claude Code, Codex, and OpenCode adapters.</p>
        <p className="mt-3 text-sm text-slate-500">
          Events: {formatFullNumber(summary.eventCount)} · Projects: {formatFullNumber(summary.projectCount)} · Devices: {formatFullNumber(summary.deviceCount)} · Last event: {formatDateTime(summary.lastEventAt)}
        </p>
        <p className="mt-1 text-xs text-slate-600">All token figures below exclude cache reuse; cache hit rate is shown separately.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <TokenCard label="Total tokens" value={summary.billableTokens} helper="Input + Output (excludes cache reuse)" />
        <TokenCard label="Input tokens" value={summary.inputTokens} helper={`${formatPercent(summary.inputTokens, summary.billableTokens)} of total`} />
        <TokenCard label="Output tokens" value={summary.outputTokens} helper={`${formatPercent(summary.outputTokens, summary.billableTokens)} of total`} />
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/20" title={`${formatFullNumber(summary.cachedInputTokens)} cached tokens reused`}>
          <div className="text-sm text-slate-400">Cache hit rate</div>
          <div className="mt-2 text-3xl font-semibold">{(summary.cacheHitRate * 100).toFixed(1)}%</div>
          <div className="mt-2 text-xs text-slate-500">{formatTokens(summary.cachedInputTokens)} reused from cache</div>
        </div>
      </section>

      <ClientSetup />

      <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <h2 className="text-xl font-semibold">Connected Clients</h2>
        <p className="mt-1 text-sm text-slate-500">Heartbeat-driven device status.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400"><tr><th className="py-2">Client</th><th>Status</th><th>Hostname</th><th>Platform</th><th>Last seen</th><th>Last sync</th><th>Last event</th><th>Tokens</th><th>Events</th></tr></thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.deviceId} className="border-t border-slate-800">
                  <td className="py-3 pr-4">{device.name}</td>
                  <td className="pr-4">{clientStatus(device.lastSeenAt)}</td>
                  <td className="pr-4 text-slate-400">{device.hostname ?? "-"}</td>
                  <td className="pr-4 text-slate-400">{device.platform ?? "-"}</td>
                  <td className="pr-4 whitespace-nowrap">{formatDateTime(device.lastSeenAt)}</td>
                  <td className="pr-4 whitespace-nowrap">{formatDateTime(device.lastSyncAt)}</td>
                  <td className="pr-4 whitespace-nowrap">{formatDateTime(device.lastEventAt)}</td>
                  <td className="pr-4" title={`${formatFullNumber(device.billableTokens)} billable tokens`}>{formatTokens(device.billableTokens)}</td>
                  <td>{formatFullNumber(device.events)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Project Ranking</h2>
              <p className="mt-1 text-sm text-slate-500">Where token usage is concentrated.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr><th className="py-2">Project</th><th>Tokens</th><th>Share</th><th>Events</th><th>Avg / event</th><th>Last active</th></tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.projectId ?? project.name} className="border-t border-slate-800">
                    <td className="py-3 pr-4"><a className="hover:underline" href={project.projectId ? `/projects/${project.projectId}` : "#"}>{project.name}</a></td>
                    <td className="pr-4" title={`${formatFullNumber(project.billableTokens)} billable tokens`}>{formatTokens(project.billableTokens)}</td>
                    <td className="pr-4">{formatPercent(project.billableTokens, summary.billableTokens)}</td>
                    <td className="pr-4">{formatFullNumber(project.events)}</td>
                    <td className="pr-4" title={`${formatFullNumber(project.avgBillablePerEvent)} billable tokens`}>{formatTokens(project.avgBillablePerEvent)}</td>
                    <td className="whitespace-nowrap text-slate-400">{formatDateTime(project.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
          <h2 className="text-xl font-semibold">Daily Usage</h2>
          <p className="mt-1 text-sm text-slate-500">Last 180 days, latest 30 active days.</p>
          <div className="mt-5 space-y-3">
            {daily.slice(-30).map((day) => {
              const width = Math.max(4, Math.round((day.billableTokens / maxDailyBillable) * 100));
              return (
                <div key={day.date}>
                  <div className="mb-1 flex justify-between gap-4 text-sm text-slate-400">
                    <span>{day.date}</span>
                    <span title={`${formatFullNumber(day.billableTokens)} billable tokens`}>{formatTokens(day.billableTokens)}</span>
                  </div>
                  <div className="h-2 rounded bg-slate-800"><div className="h-2 rounded bg-cyan-400" style={{ width: `${width}%` }} /></div>
                  <div className="mt-1 text-xs text-slate-600">Input {formatTokens(day.inputTokens)} · Output {formatTokens(day.outputTokens)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Sources" rows={sources} billableTotal={summary.billableTokens} />
        <Breakdown title="Models" rows={models.map((row) => ({ ...row, name: row.name === "unknown" ? "Unknown model" : row.name }))} billableTotal={summary.billableTokens} />
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <h2 className="text-xl font-semibold">Data Quality</h2>
        <p className="mt-1 text-sm text-slate-500">Signals that affect analysis accuracy.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <QualityMetric label="Unknown Project" value={formatTokens(summary.unknownProjectBillable)} title={`${formatFullNumber(summary.unknownProjectBillable)} billable tokens`} helper={formatPercent(summary.unknownProjectBillable, summary.billableTokens)} />
          <QualityMetric label="Unknown Model" value={formatTokens(summary.unknownModelBillable)} title={`${formatFullNumber(summary.unknownModelBillable)} billable tokens`} helper={formatPercent(summary.unknownModelBillable, summary.billableTokens)} />
          <QualityMetric label="Devices" value={formatFullNumber(summary.deviceCount)} helper={devices.map((device) => device.name).join(", ") || "No devices"} />
          <QualityMetric label="OpenCode" value="Ready" helper="SQLite parser enabled" />
          <QualityMetric label="Last Event" value={formatDateTime(summary.lastEventAt)} helper="Based on occurredAt" />
        </div>
      </section>
    </div>
  );
}

function clientStatus(lastSeenAt: string | null) {
  if (!lastSeenAt) return "Never seen";
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 2 * 60 * 1000) return "Online";
  if (ageMs < 30 * 60 * 1000) return "Stale";
  return "Offline";
}

function Breakdown({ title, rows, billableTotal }: { title: string; rows: BreakdownRow[]; billableTotal: number }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-400"><tr><th className="py-2">Name</th><th>Tokens</th><th>Share</th><th>Events</th><th>Avg / event</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-slate-800">
              <td className="py-3 pr-4">{row.name}</td>
              <td className="pr-4" title={`${formatFullNumber(row.billableTokens)} billable tokens`}>{formatTokens(row.billableTokens)}</td>
              <td className="pr-4">{formatPercent(row.billableTokens, billableTotal)}</td>
              <td className="pr-4">{formatFullNumber(row.events)}</td>
              <td title={`${formatFullNumber(row.avgBillablePerEvent)} billable tokens`}>{formatTokens(row.avgBillablePerEvent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityMetric({ label, value, helper, title }: { label: string; value: string; helper: string; title?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4" title={title}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 truncate text-2xl font-semibold">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{helper}</div>
    </div>
  );
}
