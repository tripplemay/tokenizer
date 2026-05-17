import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { MdInput, MdOutput, MdCached, MdSpeed, MdSave, MdDevices, MdInsights, MdArrowUpward, MdArrowDownward, MdRemove, MdBolt, MdPaid } from "react-icons/md";
import {
  getBreakdown,
  getDailyCost,
  getDailyBySource,
  getDailySummary,
  getDeviceSummary,
  getProjectSummary,
  getSummary
} from "@/server/summaries";
import type { ProjectFilter, RangeOption } from "@/server/summaries";
import {
  formatDateTime,
  formatFullNumber,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatUsd,
  formatWowDelta
} from "@/shared/format";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { DailyUsageChart } from "./daily-usage-chart";
import { DailyCostChart } from "./daily-cost-chart";
import { DailySourceChart } from "./daily-source-chart";
import { ProjectIcon } from "./_components/project-icon";
import { RangeSelector } from "./_components/range-selector";
import { GitFilterToggle } from "./_components/git-filter-toggle";

export const dynamic = "force-dynamic";

type BreakdownRow = {
  name: string;
  billableTokens: number;
  totalTokens: number;
  cost: number;
  events: number;
  avgBillablePerEvent: number;
};

function parseRange(raw: unknown): RangeOption {
  if (raw === "7d" || raw === "30d") return raw;
  return "all";
}

function parseGitFilter(raw: unknown): ProjectFilter {
  if (raw === "1" || raw === "gitOnly") return "gitOnly";
  return "all";
}

function rangeLabelKey(range: RangeOption): string {
  if (range === "7d") return "home.hero.rangeLabel7d";
  if (range === "30d") return "home.hero.rangeLabel30d";
  return "home.hero.rangeLabelAll";
}

// ---- Page entry ----------------------------------------------------------
// Above-the-fold sections (header, scale, hero, KPI detail, data quality)
// share `summary` and render synchronously once that one query completes.
// Everything below is wrapped in its own Suspense boundary so each chart /
// table streams in independently and the user sees something useful well
// before the slowest query is done.
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const gitFilter = parseGitFilter(params.gitOnly);

  const t = await getTranslations();
  const summary = await getSummary(range);

  const computeWow = summary.priorCompute != null ? formatWowDelta(summary.billableTokens, summary.priorCompute) : null;
  const costWow = summary.priorCost != null ? formatWowDelta(summary.totalCost, summary.priorCost) : null;
  const rangeLabel = t(rangeLabelKey(range));
  const tRelative = t as (key: string, values?: Record<string, string | number>) => string;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{t("home.title")}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{t("timezone.note")}</p>
        </div>
        <RangeSelector
          current={range}
          searchParams={params}
          labels={{
            sevenDay: t("home.range.sevenDay"),
            thirtyDay: t("home.range.thirtyDay"),
            all: t("home.range.all")
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ScaleCard label={t("home.scale.events")} value={formatFullNumber(summary.eventCount)} />
        <ScaleCard label={t("home.scale.projects")} value={formatFullNumber(summary.projectCount)} />
        <ScaleCard label={t("home.scale.devices")} value={formatFullNumber(summary.deviceCount)} />
        <ScaleCard
          label={t("home.scale.lastEvent")}
          value={formatRelativeTime(summary.lastEventAt, tRelative)}
          valueClass="text-base"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <HeroCard
          icon={<MdBolt className="h-8 w-8" />}
          label={t("home.hero.computeRange", { label: rangeLabel })}
          value={formatTokens(summary.billableTokens)}
          hint={t("home.hero.computeHint")}
          delta={computeWow}
          wowSuffix={t("home.hero.wowSuffix")}
          wowFlat={t("home.hero.wowFlat")}
          wowNoBaseline={t("home.hero.wowNoBaseline")}
          showWow={range !== "all"}
        />
        <HeroCard
          icon={<MdPaid className="h-8 w-8" />}
          label={t("home.hero.costRange", { label: rangeLabel })}
          value={formatUsd(summary.totalCost)}
          hint={t("home.hero.costHint")}
          delta={costWow}
          wowSuffix={t("home.hero.wowSuffix")}
          wowFlat={t("home.hero.wowFlat")}
          wowNoBaseline={t("home.hero.wowNoBaseline")}
          showWow={range !== "all"}
        />
        <Card extra="flex flex-col justify-center p-6">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-brand-500/10 p-2 text-brand-500">
              <MdSpeed className="h-7 w-7" />
            </span>
            <div className="flex-1">
              <div className="text-xs font-medium text-gray-500">{t("home.kpi.cacheHitRate")}</div>
              <div className="text-2xl font-bold text-navy-700 dark:text-white">
                {(summary.cacheHitRate * 100).toFixed(1)}%
              </div>
              <div className="mt-0.5 truncate text-xs text-gray-500">
                {t("home.kpi.cacheReused", { tokens: formatFullNumber(summary.cachedInputTokens) })}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
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
      </div>

      <Suspense fallback={<ChartCardSkeleton heightClass="h-72" />}>
        <DailyUsageSection range={range} />
      </Suspense>

      <Suspense fallback={<DualChartSkeleton />}>
        <DailyCostAndSourceSection range={range} />
      </Suspense>

      <Suspense fallback={<RankingSkeleton />}>
        <ProjectsAndDevicesSection range={range} gitFilter={gitFilter} searchParams={params} summaryBillable={summary.billableTokens} />
      </Suspense>

      <Suspense fallback={<BreakdownSkeleton />}>
        <BreakdownsSection range={range} summaryBillable={summary.billableTokens} />
      </Suspense>

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
            label={t("home.dataQuality.unpriced")}
            value={formatTokens(summary.unpricedTokens)}
            helper={t("home.dataQuality.unpricedHelper")}
          />
          <QualityMetric
            label={t("home.dataQuality.reasoningTokens")}
            value={formatTokens(summary.reasoningOutputTokens)}
            helper={t("home.dataQuality.reasoningHelper", { percent: formatPercent(summary.reasoningOutputTokens, summary.outputTokens) })}
          />
          <QualityMetric label={t("home.dataQuality.lastEvent")} value={formatDateTime(summary.lastEventAt)} helper={t("home.dataQuality.lastEventHelper")} />
        </div>
      </Card>
    </div>
  );
}

// ---- Streamed sections ---------------------------------------------------

async function DailyUsageSection({ range }: { range: RangeOption }) {
  const [t, daily] = await Promise.all([getTranslations(), getDailySummary(range)]);
  return (
    <Card extra="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.daily.title")}</h3>
        <p className="text-xs text-gray-600 dark:text-gray-400">{t("home.daily.subtitle", { days: daily.length })}</p>
      </div>
      <div className="h-72">
        <DailyUsageChart data={daily} />
      </div>
    </Card>
  );
}

async function DailyCostAndSourceSection({ range }: { range: RangeOption }) {
  const [t, dailyCost, dailySource] = await Promise.all([getTranslations(), getDailyCost(range), getDailyBySource(range)]);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card extra="p-6">
        <div className="mb-3">
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.dailyCost.title")}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("home.dailyCost.subtitle")}</p>
        </div>
        <div className="h-60">
          <DailyCostChart data={dailyCost} />
        </div>
      </Card>
      <Card extra="p-6">
        <div className="mb-3">
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.dailySource.title")}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("home.dailySource.subtitle")}</p>
        </div>
        <div className="h-60">
          <DailySourceChart dates={dailySource.dates} series={dailySource.series} />
        </div>
      </Card>
    </div>
  );
}

async function ProjectsAndDevicesSection({
  range,
  gitFilter,
  searchParams,
  summaryBillable
}: {
  range: RangeOption;
  gitFilter: ProjectFilter;
  searchParams: Record<string, string | string[] | undefined>;
  summaryBillable: number;
}) {
  const [t, projects, devices] = await Promise.all([
    getTranslations(),
    getProjectSummary(range, gitFilter),
    getDeviceSummary(range)
  ]);
  const tRelative = t as (key: string, values?: Record<string, string | number>) => string;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <Card extra="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.projectRanking.title")}</h3>
          <GitFilterToggle
            current={gitFilter}
            searchParams={searchParams}
            labels={{ all: t("home.filter.all"), gitOnly: t("home.filter.gitOnly") }}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("home.projectRanking.col.project")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.projectRanking.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.projectRanking.col.total")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.projectRanking.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.projectRanking.col.share")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.projectRanking.col.events")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.projectRanking.col.lastActive")}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.projectId ?? project.name} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <ProjectIcon repoKey={project.repoKey} workspacePath={project.workspacePath} />
                      <a className="font-medium hover:underline" href={project.projectId ? `/projects/${project.projectId}` : "#"}>
                        {project.name}
                      </a>
                    </div>
                  </td>
                  <td className="pr-4 text-right" title={`${formatFullNumber(project.billableTokens)} compute tokens`}>{formatTokens(project.billableTokens)}</td>
                  <td className="pr-4 text-right text-gray-500" title={`${formatFullNumber(project.totalTokens)} total tokens`}>{formatTokens(project.totalTokens)}</td>
                  <td className="pr-4 text-right font-medium">{project.cost > 0 ? formatUsd(project.cost) : "—"}</td>
                  <td className="pr-4 text-right">{formatPercent(project.billableTokens, summaryBillable)}</td>
                  <td className="pr-4 text-right">{formatFullNumber(project.events)}</td>
                  <td className="whitespace-nowrap text-right text-gray-500">{formatRelativeTime(project.lastActiveAt, tRelative)}</td>
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
                <th className="pb-3 pr-4">{t("home.connectedClients.col.client")}</th>
                <th className="pb-3 pr-4">{t("home.connectedClients.col.status")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.connectedClients.col.tokens")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.connectedClients.col.total")}</th>
                <th className="pb-3 pr-4 text-right">{t("home.connectedClients.col.cost")}</th>
                <th className="pb-3 text-right">{t("home.connectedClients.col.lastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.deviceId} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                  <td className="py-2.5 pr-4 font-medium">{device.name}</td>
                  <td className="pr-4">
                    <ClientStatusBadge lastSeenAt={device.lastSeenAt} t={t} />
                  </td>
                  <td className="pr-4 text-right" title={`${formatFullNumber(device.billableTokens)} billable tokens`}>{formatTokens(device.billableTokens)}</td>
                  <td className="pr-4 text-right text-gray-500" title={`${formatFullNumber(device.totalTokens)} total tokens`}>{formatTokens(device.totalTokens)}</td>
                  <td className="pr-4 text-right">{device.cost > 0 ? formatUsd(device.cost) : "—"}</td>
                  <td className="text-right whitespace-nowrap text-gray-500">{formatRelativeTime(device.lastSeenAt, tRelative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function BreakdownsSection({ range, summaryBillable }: { range: RangeOption; summaryBillable: number }) {
  const [t, sources, models] = await Promise.all([
    getTranslations(),
    getBreakdown("source", range),
    getBreakdown("model", range)
  ]);
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <BreakdownCard
        title={t("home.breakdown.sources")}
        rows={sources}
        billableTotal={summaryBillable}
        col={{
          name: t("home.breakdown.col.name"),
          compute: t("home.breakdown.col.compute"),
          total: t("home.breakdown.col.total"),
          cost: t("home.breakdown.col.cost"),
          share: t("home.breakdown.col.share"),
          events: t("home.breakdown.col.events")
        }}
      />
      <BreakdownCard
        title={t("home.breakdown.models")}
        rows={models.map((row) => ({ ...row, name: row.name === "unknown" ? t("home.unknownModel") : row.name }))}
        billableTotal={summaryBillable}
        col={{
          name: t("home.breakdown.col.name"),
          compute: t("home.breakdown.col.compute"),
          total: t("home.breakdown.col.total"),
          cost: t("home.breakdown.col.cost"),
          share: t("home.breakdown.col.share"),
          events: t("home.breakdown.col.events")
        }}
      />
    </div>
  );
}

// ---- Skeletons -----------------------------------------------------------

function ChartCardSkeleton({ heightClass = "h-72" }: { heightClass?: string }) {
  return (
    <Card extra="p-6">
      <div className="mb-4 h-5 w-40 rounded bg-gray-100 dark:bg-white/10" />
      <div className={`${heightClass} animate-pulse rounded-xl bg-gray-100 dark:bg-white/5`} />
    </Card>
  );
}

function DualChartSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ChartCardSkeleton heightClass="h-60" />
      <ChartCardSkeleton heightClass="h-60" />
    </div>
  );
}

function RankingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <Card extra="p-6">
        <div className="mb-4 h-5 w-32 rounded bg-gray-100 dark:bg-white/10" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
          ))}
        </div>
      </Card>
      <Card extra="p-6">
        <div className="mb-4 h-5 w-32 rounded bg-gray-100 dark:bg-white/10" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
          ))}
        </div>
      </Card>
    </div>
  );
}

function BreakdownSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {[0, 1].map((i) => (
        <Card key={i} extra="p-6">
          <div className="mb-4 h-5 w-24 rounded bg-gray-100 dark:bg-white/10" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-7 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---- Pure presentational helpers (unchanged from prior revision) ---------

function ScaleCard({ label, value, valueClass = "text-xl" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-navy-800">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 truncate font-bold text-navy-700 dark:text-white ${valueClass}`}>{value}</div>
    </div>
  );
}

function HeroCard({
  icon,
  label,
  value,
  hint,
  delta,
  wowSuffix,
  wowFlat,
  wowNoBaseline,
  showWow
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  delta: { text: string; direction: "up" | "down" | "flat" } | null;
  wowSuffix: string;
  wowFlat: string;
  wowNoBaseline: string;
  showWow: boolean;
}) {
  return (
    <Card extra="p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-brand-500/10 p-2 text-brand-500">{icon}</span>
        <div className="flex-1">
          <div className="text-xs font-medium text-gray-500">{label}</div>
          <div className="mt-1 text-3xl font-bold text-navy-700 dark:text-white">{value}</div>
          {showWow ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              <WowBadge delta={delta} flat={wowFlat} noBaseline={wowNoBaseline} />
              <span className="text-gray-500">{wowSuffix}</span>
            </div>
          ) : null}
          <div className="mt-1 text-xs text-gray-500">{hint}</div>
        </div>
      </div>
    </Card>
  );
}

function WowBadge({
  delta,
  flat,
  noBaseline
}: {
  delta: { text: string; direction: "up" | "down" | "flat" } | null;
  flat: string;
  noBaseline: string;
}) {
  if (!delta) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-500 dark:bg-white/10">{noBaseline}</span>;
  }
  if (delta.direction === "flat") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
        <MdRemove className="h-3 w-3" />
        {flat}
      </span>
    );
  }
  if (delta.direction === "up") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
        <MdArrowUpward className="h-3 w-3" />
        {delta.text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300">
      <MdArrowDownward className="h-3 w-3" />
      {delta.text}
    </span>
  );
}

function clientStatus(lastSeenAt: string | null) {
  // Cron-mode clients (default WSL install) ping the server every 15 minutes,
  // so a 2-minute "Online" window left the device showing Stale most of the
  // time. The thresholds below correspond to "missed 0 cycles" (Online),
  // "missed up to ~3 cycles" (Stale), and "missed more" (Offline).
  if (!lastSeenAt) return { key: "neverSeen" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 20 * 60 * 1000) return { key: "online" as const, color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
  if (ageMs < 60 * 60 * 1000) return { key: "stale" as const, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" };
  return { key: "offline" as const, color: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" };
}

function ClientStatusBadge({ lastSeenAt, t }: { lastSeenAt: string | null; t: (k: string) => string }) {
  const { key, color } = clientStatus(lastSeenAt);
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{t(`clientStatus.${key}`)}</span>;
}

function BreakdownCard({
  title,
  rows,
  billableTotal,
  col
}: {
  title: string;
  rows: BreakdownRow[];
  billableTotal: number;
  col: { name: string; compute: string; total: string; cost: string; share: string; events: string };
}) {
  return (
    <Card extra="p-6">
      <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">{col.name}</th>
              <th className="pb-3 pr-4 text-right">{col.compute}</th>
              <th className="pb-3 pr-4 text-right">{col.total}</th>
              <th className="pb-3 pr-4 text-right">{col.cost}</th>
              <th className="pb-3 pr-4 text-right">{col.share}</th>
              <th className="pb-3 pr-4 text-right">{col.events}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-gray-200 dark:border-white/10 text-navy-700 dark:text-white">
                <td className="py-2.5 pr-4 font-medium">{row.name}</td>
                <td className="pr-4 text-right" title={`${formatFullNumber(row.billableTokens)} compute tokens`}>{formatTokens(row.billableTokens)}</td>
                <td className="pr-4 text-right text-gray-500" title={`${formatFullNumber(row.totalTokens)} total tokens`}>{formatTokens(row.totalTokens)}</td>
                <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                <td className="pr-4 text-right">{formatPercent(row.billableTokens, billableTotal)}</td>
                <td className="pr-4 text-right">{formatFullNumber(row.events)}</td>
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
