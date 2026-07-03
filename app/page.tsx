import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
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
import { ModelLink } from "./_components/model-link";
import { RangeSelector } from "./_components/range-selector";
import { GitFilterToggle } from "./_components/git-filter-toggle";
import { Sparkline } from "./_components/sparkline";
import { AnimatedNumber } from "./_components/animated-number";
import { ShareBar } from "./_components/share-bar";
import { SourceCardGrid } from "./_components/source-card-grid";
import { PlatformIcon } from "./_components/platform-icon";
import { OnboardingCard } from "./_components/onboarding-card";
import { PageBanner } from "./_components/page-banner";
import { SubscriptionCard } from "./_components/subscription-card";

export const dynamic = "force-dynamic";

const HOVER_LIFT = "transition duration-200 hover:-translate-y-0.5 hover:shadow-lg";

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
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const gitFilter = parseGitFilter(params.gitOnly);

  const session = await requireSession();
  const tenantId = session.user.id;
  const tz = await getUserTimezone(tenantId);
  const t = await getTranslations();
  const summary = await getSummary(tenantId, range);

  // Fresh tenants land on a guided onboarding card instead of a wall of
  // zeros. Threshold is "no events", not "no devices" — a device that just
  // enrolled but hasn't synced yet still gets the onboarding view so the
  // user has feedback while they wait for the first sync.
  if (summary.eventCount === 0) {
    const devices = await getDeviceSummary(tenantId, "all");
    return (
      <div className="space-y-6">
        <OnboardingCard initialDeviceIds={devices.map((d) => d.deviceId)} />
      </div>
    );
  }

  const rangeLabel = t(rangeLabelKey(range));
  const tRelative = t as (key: string, values?: Record<string, string | number>) => string;

  return (
    <div className="space-y-6">
      <PageBanner
        title={t("home.title")}
        note={<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("timezone.note", { tz })}</p>}
        rightSlot={
          <RangeSelector
            current={range}
            searchParams={params}
            labels={{
              sevenDay: t("home.range.sevenDay"),
              thirtyDay: t("home.range.thirtyDay"),
              all: t("home.range.all")
            }}
          />
        }
      />

      {/* SCALE ROW (12-grid) */}
      <div className="grid grid-cols-12 gap-5">
        <ScaleCard className="col-span-6 lg:col-span-3" label={t("home.scale.events")} value={formatFullNumber(summary.eventCount)} />
        <ScaleCard className="col-span-6 lg:col-span-3" label={t("home.scale.projects")} value={formatFullNumber(summary.projectCount)} />
        <ScaleCard className="col-span-6 lg:col-span-3" label={t("home.scale.devices")} value={formatFullNumber(summary.deviceCount)} />
        <ScaleCard
          className="col-span-6 lg:col-span-3"
          label={t("home.scale.lastEvent")}
          value={formatRelativeTime(summary.lastEventAt, tRelative, tz)}
          valueClass="text-base"
        />
      </div>

      {/* HERO ROW — async because sparkline data is fetched per range */}
      <Suspense fallback={<HeroRowSkeleton />}>
        <HeroSection
          tenantId={tenantId}
          range={range}
          summary={summary}
          rangeLabel={rangeLabel}
          tz={tz}
          labels={{
            computeRange: t("home.hero.computeRange", { label: rangeLabel }),
            computeHint: t("home.hero.computeHint"),
            costRange: t("home.hero.costRange", { label: rangeLabel }),
            costHint: t("home.hero.costHint"),
            cacheHitRate: t("home.kpi.cacheHitRate"),
            cacheReused: t("home.kpi.cacheReused", { tokens: formatFullNumber(summary.cachedInputTokens) }),
            wowSuffix: t("home.hero.wowSuffix"),
            wowFlat: t("home.hero.wowFlat"),
            wowNoBaseline: t("home.hero.wowNoBaseline")
          }}
        />
      </Suspense>

      {/* SUBSCRIPTION ROW */}
      <Suspense fallback={<SubscriptionCardSkeleton />}>
        <SubscriptionCard userId={tenantId} />
      </Suspense>

      {/* KPI ROW — same column rhythm as Scale row */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-6 lg:col-span-3" title={t("home.kpi.inputHint")}>
          <Widget icon={<MdInput className="h-7 w-7" />} title={t("home.kpi.inputTokens")} subtitle={formatTokens(summary.inputTokens)} />
        </div>
        <div className="col-span-6 lg:col-span-3" title={t("home.kpi.cacheWriteHint")}>
          <Widget icon={<MdSave className="h-7 w-7" />} title={t("home.kpi.cacheWrite")} subtitle={formatTokens(summary.cacheWriteTokens)} />
        </div>
        <div className="col-span-6 lg:col-span-3" title={t("home.kpi.cacheReuseHint")}>
          <Widget icon={<MdCached className="h-7 w-7" />} title={t("home.kpi.cacheReuse")} subtitle={formatTokens(summary.cachedInputTokens)} />
        </div>
        <div className="col-span-6 lg:col-span-3" title={t("home.kpi.outputHint", { reasoning: formatTokens(summary.reasoningOutputTokens) })}>
          <Widget icon={<MdOutput className="h-7 w-7" />} title={t("home.kpi.outputTokens")} subtitle={formatTokens(summary.outputTokens)} />
        </div>
      </div>

      <Suspense fallback={<ChartCardSkeleton heightClass="h-72" />}>
        <DailyUsageSection tenantId={tenantId} range={range} tz={tz} />
      </Suspense>

      <Suspense fallback={<DualChartSkeleton />}>
        <DailyCostAndSourceSection tenantId={tenantId} range={range} tz={tz} />
      </Suspense>

      <Suspense fallback={<RankingSkeleton />}>
        <ProjectsAndDevicesSection tenantId={tenantId} range={range} gitFilter={gitFilter} searchParams={params} summaryBillable={summary.billableTokens} tz={tz} />
      </Suspense>

      <Suspense fallback={<SourcesGridSkeleton />}>
        <SourcesGridSection tenantId={tenantId} range={range} summaryBillable={summary.billableTokens} tz={tz} />
      </Suspense>

      <Suspense fallback={<ChartCardSkeleton heightClass="h-64" />}>
        <ModelsBreakdownSection tenantId={tenantId} range={range} summaryBillable={summary.billableTokens} />
      </Suspense>

      <Card extra="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MdInsights className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.dataQuality.title")}</h3>
        </div>
        <div className="grid grid-cols-12 gap-4">
          <QualityMetric
            className="col-span-12 sm:col-span-6 lg:col-span-3 xl:col-span-2"
            label={t("home.dataQuality.unknownProject")}
            value={formatTokens(summary.unknownProjectBillable)}
            helper={formatPercent(summary.unknownProjectBillable, summary.billableTokens)}
            healthRatio={summary.unknownProjectBillable / Math.max(1, summary.billableTokens)}
          />
          <QualityMetric
            className="col-span-12 sm:col-span-6 lg:col-span-3 xl:col-span-2"
            label={t("home.dataQuality.unknownModel")}
            value={formatTokens(summary.unknownModelBillable)}
            helper={formatPercent(summary.unknownModelBillable, summary.billableTokens)}
            healthRatio={summary.unknownModelBillable / Math.max(1, summary.billableTokens)}
          />
          <QualityMetric
            className="col-span-12 sm:col-span-6 lg:col-span-3 xl:col-span-2"
            label={t("home.dataQuality.unpriced")}
            value={formatTokens(summary.unpricedTokens)}
            helper={t("home.dataQuality.unpricedHelper")}
            healthRatio={summary.unpricedTokens / Math.max(1, summary.totalTokens)}
          />
          <QualityMetric
            className="col-span-12 sm:col-span-6 lg:col-span-3 xl:col-span-2"
            label={t("home.dataQuality.fallback")}
            value={formatFullNumber(summary.fallbackEvents)}
            helper={t("home.dataQuality.fallbackHelper")}
            healthRatio={summary.fallbackEvents / Math.max(1, summary.eventCount)}
          />
          <QualityMetric
            className="col-span-12 sm:col-span-6 lg:col-span-6 xl:col-span-2"
            label={t("home.dataQuality.reasoningTokens")}
            value={formatTokens(summary.reasoningOutputTokens)}
            helper={t("home.dataQuality.reasoningHelper", { percent: formatPercent(summary.reasoningOutputTokens, summary.outputTokens) })}
          />
          <QualityMetric
            className="col-span-12 sm:col-span-6 lg:col-span-6 xl:col-span-2"
            label={t("home.dataQuality.lastEvent")}
            value={formatDateTime(summary.lastEventAt, tz)}
            helper={t("home.dataQuality.lastEventHelper")}
            valueClass="text-base"
          />
        </div>
      </Card>
    </div>
  );
}

// ---- Streamed sections ---------------------------------------------------

type SummaryShape = Awaited<ReturnType<typeof getSummary>>;

async function HeroSection({
  tenantId,
  range,
  summary,
  labels,
  tz
}: {
  tenantId: string;
  range: RangeOption;
  summary: SummaryShape;
  rangeLabel: string;
  tz: string;
  labels: {
    computeRange: string;
    computeHint: string;
    costRange: string;
    costHint: string;
    cacheHitRate: string;
    cacheReused: string;
    wowSuffix: string;
    wowFlat: string;
    wowNoBaseline: string;
  };
}) {
  // Sparklines reuse the daily series (cached, near-free). Cache-hit
  // sparkline is computed inline from the same dailySummary rather than
  // adding another query.
  const [dailySummary, dailyCost] = await Promise.all([getDailySummary(tenantId, range, tz), getDailyCost(tenantId, range, tz)]);
  const computeSpark = dailySummary.map((d) => d.billableTokens);
  const costSpark = dailyCost.map((d) => d.cost);
  const cacheSpark = dailySummary.map((d) => (d.inputTokens > 0 ? Math.min(100, (d.cachedInputTokens / d.inputTokens) * 100) : 0));

  const computeWow = summary.priorCompute != null ? formatWowDelta(summary.billableTokens, summary.priorCompute) : null;
  const costWow = summary.priorCost != null ? formatWowDelta(summary.totalCost, summary.priorCost) : null;
  const showWow = range !== "all";

  return (
    <div className="grid grid-cols-12 gap-5">
      <HeroCard
        className="col-span-12 lg:col-span-4"
        icon={<MdBolt className="h-7 w-7" />}
        label={labels.computeRange}
        hint={labels.computeHint}
        value={summary.billableTokens}
        valueKind="tokens"
        spark={computeSpark}
        sparkColor="#4318FF"
        delta={computeWow}
        showWow={showWow}
        wowSuffix={labels.wowSuffix}
        wowFlat={labels.wowFlat}
        wowNoBaseline={labels.wowNoBaseline}
      />
      <HeroCard
        className="col-span-12 lg:col-span-4"
        icon={<MdPaid className="h-7 w-7" />}
        label={labels.costRange}
        hint={labels.costHint}
        value={summary.totalCost}
        valueKind="usd"
        spark={costSpark}
        sparkColor="#FFB547"
        delta={costWow}
        showWow={showWow}
        wowSuffix={labels.wowSuffix}
        wowFlat={labels.wowFlat}
        wowNoBaseline={labels.wowNoBaseline}
      />
      <HeroCard
        className="col-span-12 lg:col-span-4"
        icon={<MdSpeed className="h-7 w-7" />}
        label={labels.cacheHitRate}
        hint={labels.cacheReused}
        value={summary.cacheHitRate * 100}
        valueKind="percent"
        spark={cacheSpark}
        sparkColor="#01B574"
        delta={null}
        showWow={false}
        wowSuffix={labels.wowSuffix}
        wowFlat={labels.wowFlat}
        wowNoBaseline={labels.wowNoBaseline}
      />
    </div>
  );
}

async function DailyUsageSection({ tenantId, range, tz }: { tenantId: string; range: RangeOption; tz: string }) {
  const [t, daily] = await Promise.all([getTranslations(), getDailySummary(tenantId, range, tz)]);
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

async function DailyCostAndSourceSection({ tenantId, range, tz }: { tenantId: string; range: RangeOption; tz: string }) {
  const [t, dailyCost, dailySource] = await Promise.all([getTranslations(), getDailyCost(tenantId, range, tz), getDailyBySource(tenantId, range, tz)]);
  return (
    <div className="grid grid-cols-12 gap-5">
      <Card extra="col-span-12 lg:col-span-6 p-6">
        <div className="mb-3">
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.dailyCost.title")}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("home.dailyCost.subtitle")}</p>
        </div>
        <div className="h-60">
          <DailyCostChart data={dailyCost} />
        </div>
      </Card>
      <Card extra="col-span-12 lg:col-span-6 p-6">
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
  tenantId,
  range,
  gitFilter,
  searchParams,
  summaryBillable,
  tz
}: {
  tenantId: string;
  range: RangeOption;
  gitFilter: ProjectFilter;
  searchParams: Record<string, string | string[] | undefined>;
  summaryBillable: number;
  tz: string;
}) {
  const [t, projects, devices] = await Promise.all([
    getTranslations(),
    getProjectSummary(tenantId, range, gitFilter),
    getDeviceSummary(tenantId, range)
  ]);
  const tRelative = t as (key: string, values?: Record<string, string | number>) => string;
  return (
    <div className="grid grid-cols-12 gap-5">
      <Card extra="col-span-12 xl:col-span-8 p-6">
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
                <tr key={project.projectId ?? project.name} className="border-t border-gray-200 text-navy-700 transition-colors hover:bg-brand-500/5 dark:border-white/10 dark:text-white dark:hover:bg-white/5">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <ProjectIcon repoKey={project.repoKey} workspacePath={project.workspacePath} folderTitle={t("project.localFolderTooltip")} />
                      <a className="font-medium hover:underline" href={project.projectId ? `/projects/${project.projectId}` : "#"}>
                        {project.name}
                      </a>
                    </div>
                  </td>
                  <td className="pr-4 text-right" title={`${formatFullNumber(project.billableTokens)} compute tokens`}>{formatTokens(project.billableTokens)}</td>
                  <td className="pr-4 text-right text-gray-500" title={`${formatFullNumber(project.totalTokens)} total tokens`}>{formatTokens(project.totalTokens)}</td>
                  <td className="pr-4 text-right font-medium">{project.cost > 0 ? formatUsd(project.cost) : "—"}</td>
                  <td className="pr-4 text-right">
                    <ShareBar value={project.billableTokens} total={summaryBillable} />
                  </td>
                  <td className="pr-4 text-right">{formatFullNumber(project.events)}</td>
                  <td className="whitespace-nowrap text-right text-gray-500">{formatRelativeTime(project.lastActiveAt, tRelative, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card extra="col-span-12 xl:col-span-4 p-6">
        <div className="mb-4 flex items-center gap-2">
          <MdDevices className="h-5 w-5 text-brand-500" />
          <h3 className="text-lg font-bold text-navy-700 dark:text-white">{t("home.connectedClients.title")}</h3>
        </div>
        {/* Compact stacked list instead of a 6-column table — the card sits in
            a narrow xl:col-span-4 slot where a wide table would force an
            internal horizontal scrollbar. Each row stays self-contained:
            platform icon + name + status on the top line, metrics + last
            seen on the bottom line. */}
        <ul className="divide-y divide-gray-200 dark:divide-white/10">
          {devices.map((device) => (
            <li key={device.deviceId} className="group">
              <a
                href={`/devices/${device.deviceId}`}
                className="-mx-2 flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-brand-500/5 dark:hover:bg-white/5"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5">
                  <PlatformIcon platform={device.platform} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-navy-700 dark:text-white">{device.name}</span>
                    <ClientStatusBadge lastSeenAt={device.lastSeenAt} t={t} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <span title={`${formatFullNumber(device.billableTokens)} ${t("home.connectedClients.col.tokens")}`}>{formatTokens(device.billableTokens)}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span title={`${formatFullNumber(device.totalTokens)} ${t("home.connectedClients.col.total")}`}>{formatTokens(device.totalTokens)}</span>
                    {device.cost > 0 ? (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{formatUsd(device.cost)}</span>
                      </>
                    ) : null}
                    <span className="ml-auto whitespace-nowrap text-gray-500">{formatRelativeTime(device.lastSeenAt, tRelative, tz)}</span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

async function SourcesGridSection({ tenantId, range, summaryBillable, tz }: { tenantId: string; range: RangeOption; summaryBillable: number; tz: string }) {
  const [t, sources, dailyBySource] = await Promise.all([
    getTranslations(),
    getBreakdown(tenantId, "source", range),
    getDailyBySource(tenantId, range, tz)
  ]);
  if (sources.length === 0) return null;
  return (
    <Card extra="p-6">
      <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("home.breakdown.sources")}</h3>
      <SourceCardGrid
        rows={sources}
        billableTotal={summaryBillable}
        series={dailyBySource.series}
        labels={{
          compute: t("home.breakdown.col.compute"),
          cost: t("home.breakdown.col.cost"),
          events: t("home.breakdown.col.events")
        }}
      />
    </Card>
  );
}

async function ModelsBreakdownSection({ tenantId, range, summaryBillable }: { tenantId: string; range: RangeOption; summaryBillable: number }) {
  const [t, models] = await Promise.all([getTranslations(), getBreakdown(tenantId, "model", range)]);
  return (
    <Card extra="p-6">
      <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("home.breakdown.models")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-3">{t("home.breakdown.col.name")}</th>
              <th className="pb-3 pr-4 text-right">{t("home.breakdown.col.compute")}</th>
              <th className="pb-3 pr-4 text-right">{t("home.breakdown.col.total")}</th>
              <th className="pb-3 pr-4 text-right">{t("home.breakdown.col.cost")}</th>
              <th className="pb-3 pr-4 text-right">{t("home.breakdown.col.share")}</th>
              <th className="pb-3 pr-4 text-right">{t("home.breakdown.col.events")}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((row) => {
              const display = row.name === "unknown" ? t("home.unknownModel") : row.name;
              return (
                <tr key={row.name} className="border-t border-gray-200 text-navy-700 transition-colors hover:bg-brand-500/5 dark:border-white/10 dark:text-white dark:hover:bg-white/5">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorForModel(row.name) }} />
                      <ModelLink model={row.name === "unknown" ? null : row.name} fallback={display} className="font-medium" />
                    </div>
                  </td>
                  <td className="pr-4 text-right" title={`${formatFullNumber(row.billableTokens)} compute tokens`}>{formatTokens(row.billableTokens)}</td>
                  <td className="pr-4 text-right text-gray-500" title={`${formatFullNumber(row.totalTokens)} total tokens`}>{formatTokens(row.totalTokens)}</td>
                  <td className="pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                  <td className="pr-4 text-right">
                    <ShareBar value={row.billableTokens} total={summaryBillable} colorHex={colorForModel(row.name)} />
                  </td>
                  <td className="pr-4 text-right">{formatFullNumber(row.events)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Subtle visual cue: each model family gets a colored dot so the eye can
// group them when scanning the table.
function colorForModel(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "#7C3AED";
  if (m.startsWith("gpt")) return "#0EA5E9";
  if (m.startsWith("gemini")) return "#EF4444";
  if (m.startsWith("mimo")) return "#F59E0B";
  if (m.startsWith("minimax")) return "#10B981";
  return "#A3AED0";
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
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 lg:col-span-6"><ChartCardSkeleton heightClass="h-60" /></div>
      <div className="col-span-12 lg:col-span-6"><ChartCardSkeleton heightClass="h-60" /></div>
    </div>
  );
}

function RankingSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-5">
      <Card extra="col-span-12 xl:col-span-8 p-6">
        <div className="mb-4 h-5 w-32 rounded bg-gray-100 dark:bg-white/10" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
          ))}
        </div>
      </Card>
      <Card extra="col-span-12 xl:col-span-4 p-6">
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

function SourcesGridSkeleton() {
  return (
    <Card extra="p-6">
      <div className="mb-4 h-5 w-24 rounded bg-gray-100 dark:bg-white/10" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5" />
        ))}
      </div>
    </Card>
  );
}

function SubscriptionCardSkeleton() {
  return (
    <Card extra="p-6">
      <div className="mb-4 h-5 w-40 rounded bg-gray-100 dark:bg-white/10" />
      <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />
    </Card>
  );
}

function HeroRowSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="col-span-12 lg:col-span-4 h-44 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5" />
      ))}
    </div>
  );
}

// ---- Presentational ------------------------------------------------------

function ScaleCard({ className = "", label, value, valueClass = "text-xl" }: { className?: string; label: string; value: string; valueClass?: string }) {
  return (
    <div className={`${className} rounded-2xl border border-gray-200 bg-white px-4 py-3 ${HOVER_LIFT} dark:border-white/10 dark:bg-navy-800`}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 truncate font-bold text-navy-700 dark:text-white ${valueClass}`}>{value}</div>
    </div>
  );
}

function HeroCard({
  className = "",
  icon,
  label,
  value,
  valueKind,
  hint,
  delta,
  spark,
  sparkColor,
  showWow,
  wowSuffix,
  wowFlat,
  wowNoBaseline
}: {
  className?: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  valueKind: "tokens" | "usd" | "percent";
  hint: string;
  delta: { text: string; direction: "up" | "down" | "flat" } | null;
  spark: number[];
  sparkColor: string;
  showWow: boolean;
  wowSuffix: string;
  wowFlat: string;
  wowNoBaseline: string;
}) {
  return (
    <div className={className}>
      <Card extra={`p-6 ${HOVER_LIFT}`}>
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-brand-500/10 p-2 text-brand-500">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div className="mt-1 truncate font-display text-4xl font-bold tracking-tight text-navy-700 dark:text-white">
              <AnimatedNumber value={value} kind={valueKind} />
            </div>
            {showWow ? (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                <WowBadge delta={delta} flat={wowFlat} noBaseline={wowNoBaseline} />
                <span className="text-gray-500">{wowSuffix}</span>
              </div>
            ) : null}
            <div className="mt-1 truncate text-xs text-gray-500">{hint}</div>
          </div>
        </div>
        {spark.length > 0 ? (
          <div className="-mx-2 -mb-4 mt-3">
            <Sparkline data={spark} color={sparkColor} height={44} />
          </div>
        ) : null}
      </Card>
    </div>
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

function QualityMetric({
  className = "",
  label,
  value,
  helper,
  valueClass = "text-xl",
  healthRatio
}: {
  className?: string;
  label: string;
  value: string;
  helper: string;
  valueClass?: string;
  // 0..1 representing how concerning this metric's value is. > 30% = red,
  // 10–30% = amber, ≤ 10% = green; undefined leaves border neutral.
  healthRatio?: number;
}) {
  let border = "border-gray-200 dark:border-white/10";
  if (healthRatio != null) {
    if (healthRatio > 0.3) border = "border-red-200 dark:border-red-400/30";
    else if (healthRatio > 0.1) border = "border-amber-200 dark:border-amber-400/30";
    else if (healthRatio > 0) border = "border-emerald-200 dark:border-emerald-400/20";
  }
  return (
    <div className={`${className} rounded-2xl border ${border} bg-white p-4 dark:bg-navy-900/40`}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1.5 truncate font-bold text-navy-700 dark:text-white ${valueClass}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-gray-500" title={helper}>{helper}</div>
    </div>
  );
}
