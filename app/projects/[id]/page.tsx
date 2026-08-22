import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MdArrowBack, MdBolt, MdInput, MdOutput, MdCached, MdPaid } from "react-icons/md";
import { prisma } from "@/server/db";
import { getProjectDetail } from "@/server/summaries";
import { getBatchCost, MAX_LINKED_HARNESS_PROJECTS, quantizedNowMs, type BatchCost } from "@/server/harness-cost";
import { requireSession } from "@/server/auth-session";
import { getUserTimezone } from "@/server/timezone";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { formatDateTimeSeconds, formatFullNumber, formatPercent, formatTokens, formatUsd } from "@/shared/format";
import { SourcePill } from "../../_components/source-pill";
import { ModelLink } from "../../_components/model-link";
import { ProjectIcon } from "../../_components/project-icon";
import { PageBanner } from "../../_components/page-banner";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const tenantId = session.user.id;
  const tz = await getUserTimezone(tenantId);
  // Scope project lookup to the current tenant so a leaked URL like
  // /projects/<some-other-users-id> doesn't reveal someone else's project.
  const [t, project, detail, harnessProjectRows] = await Promise.all([
    getTranslations(),
    prisma.project.findFirst({ where: { id, userId: tenantId } }),
    getProjectDetail(tenantId, id),
    // BL-COST-BATCH-V1 F003：该用量项目关联的 harness 批次（外键 HarnessProject.projectId）
    prisma.harnessProject.findMany({
      where: { projectId: id, userId: tenantId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      // Read one look-ahead row so truncation is observable without a second
      // count query. Only the first MAX rows are costed and rendered below.
      take: MAX_LINKED_HARNESS_PROJECTS + 1,
      select: {
        id: true,
        name: true,
        batch: true,
        status: true,
        repoKey: true,
        transitions: {
          where: { userId: tenantId },
          // 与 harness-detail.ts 的 transitions 序完全一致（含次级 id 序）——cache key 同一性前提
          orderBy: [{ observedAt: "desc" as const }, { id: "desc" as const }],
          take: 100,
          select: {
            fromStatus: true,
            toStatus: true,
            toBatch: true,
            batchBoundary: true,
            fixRounds: true,
            observedAt: true
          }
        }
      }
    })
  ]);

  if (!project) {
    return (
      <div className="space-y-5">
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          {t("project.back")}
        </Link>
        <Card extra="p-6">
          <p className="text-navy-700 dark:text-white">{t("project.notFound")}</p>
        </Card>
      </div>
    );
  }

  const harnessProjectsTruncated = harnessProjectRows.length > MAX_LINKED_HARNESS_PROJECTS;
  const harnessProjects = harnessProjectRows.slice(0, MAX_LINKED_HARNESS_PROJECTS);
  const { totals, events, bySource, byModel, projectCost } = detail;

  // 与 /harness/[id] overview 同口径同值：同一 getBatchCost 导出 + 量化 now
  //（同一 30s 缓存窗口内两页命中同一 key）。projectId 恒为本页 id（非 null），
  // 不需要 repoKey 回退。
  const nowMs = quantizedNowMs();
  const harnessBatchCosts: Array<{
    harnessProject: (typeof harnessProjects)[number];
    cost: BatchCost | null;
  }> = await Promise.all(
    harnessProjects.map(async (harnessProject) => ({
      harnessProject,
      cost: await getBatchCost(tenantId, { projectId: id, repoKey: harnessProject.repoKey }, harnessProject.transitions, nowMs)
    }))
  );
  const harnessStatusLabel = (status: string | null): string => {
    if (!status) return "—";
    const key = `harness.status.phase.${status}`;
    return t.has(key) ? t(key) : status;
  };
  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const cachedInputTokens = totals._sum.cachedInputTokens ?? 0;
  const billableTokens = Math.max(0, inputTokens - cachedInputTokens) + outputTokens;

  return (
    <div className="space-y-5">
      <PageBanner
        overline={
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
            <MdArrowBack className="h-4 w-4" />
            {t("project.back")}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-2">
            {project.name}
            <ProjectIcon repoKey={project.repoKey} workspacePath={project.workspacePath} size="md" folderTitle={t("project.localFolderTooltip")} />
          </span>
        }
        subtitle={<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{project.workspacePath ?? t("project.noWorkspace")}</p>}
        note={
          <>
            <p className="mt-0.5 text-xs text-gray-500">{t("project.aggregateNote")}</p>
            <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note", { tz })}</p>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-5">
        <Widget icon={<MdInput className="h-7 w-7" />} title={t("project.metric.input")} subtitle={formatTokens(inputTokens)} />
        <Widget icon={<MdCached className="h-7 w-7" />} title={t("project.metric.cacheRead")} subtitle={formatTokens(cachedInputTokens)} />
        <Widget icon={<MdOutput className="h-7 w-7" />} title={t("project.metric.output")} subtitle={formatTokens(outputTokens)} />
        <Widget icon={<MdBolt className="h-7 w-7" />} title={t("project.metric.compute")} subtitle={formatTokens(billableTokens)} />
        <Widget icon={<MdPaid className="h-7 w-7" />} title={t("project.metric.cost")} subtitle={projectCost > 0 ? formatUsd(projectCost) : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("project.sources")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("project.col.source")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.total")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {bySource.map((row) => {
                const compute = Math.max(0, (row._sum.inputTokens ?? 0) - (row._sum.cachedInputTokens ?? 0)) + (row._sum.outputTokens ?? 0);
                const total = (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0);
                return (
                  <tr key={row.source} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4"><SourcePill source={row.source} /></td>
                    <td className="py-2.5 pr-4 text-right" title={`${formatFullNumber(compute)} compute tokens`}>{formatTokens(compute)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-500" title={`${formatFullNumber(total)} total tokens`}>{formatTokens(total)}</td>
                    <td className="py-2.5 pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                    <td className="py-2.5 pr-4 text-right">{formatFullNumber(row._count)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("project.models")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("project.col.model")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.compute")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.total")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.cost")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.share")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => {
                const compute = Math.max(0, (row._sum.inputTokens ?? 0) - (row._sum.cachedInputTokens ?? 0)) + (row._sum.outputTokens ?? 0);
                const total = (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0);
                return (
                  <tr key={row.model ?? "unknown"} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium"><ModelLink model={row.model} fallback={t("project.unknownModel")} /></td>
                    <td className="py-2.5 pr-4 text-right" title={`${formatFullNumber(compute)} compute tokens`}>{formatTokens(compute)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-500" title={`${formatFullNumber(total)} total tokens`}>{formatTokens(total)}</td>
                    <td className="py-2.5 pr-4 text-right font-medium">{row.cost > 0 ? formatUsd(row.cost) : "—"}</td>
                    <td className="py-2.5 pr-4 text-right">{formatPercent(compute, billableTokens)}</td>
                    <td className="py-2.5 pr-4 text-right">{formatFullNumber(row._count)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {harnessBatchCosts.length > 0 ? (
        <Card extra="p-6">
          <h3 className="mb-1 text-lg font-bold text-navy-700 dark:text-white">{t("project.harnessCost.title")}</h3>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t("project.harnessCost.note")}</p>
          {harnessProjectsTruncated ? (
            <p className="mb-4 text-xs font-medium text-amber-700 dark:text-amber-300">
              {t("project.harnessCost.truncated", { count: MAX_LINKED_HARNESS_PROJECTS })}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-3 pr-4">{t("project.harnessCost.col.batch")}</th>
                  <th className="pb-3 pr-4">{t("project.harnessCost.col.status")}</th>
                  <th className="pb-3 pr-4 text-right">{t("project.harnessCost.col.compute")}</th>
                  <th className="pb-3 pr-4 text-right">{t("project.harnessCost.col.cost")}</th>
                  <th className="pb-3"></th>
                </tr>
              </thead>
              <tbody>
                {harnessBatchCosts.map(({ harnessProject, cost }) => (
                  <tr key={harnessProject.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4 font-mono">{harnessProject.batch ?? "—"}</td>
                    <td className="py-2.5 pr-4">
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
                        {harnessStatusLabel(harnessProject.status)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">
                      {cost ? formatTokens(cost.totalComputeTokens) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-medium">{cost ? formatUsd(cost.totalCostUsd) : "—"}</td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`/harness/${encodeURIComponent(harnessProject.id)}`}
                        className="text-xs font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {t("project.harnessCost.open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("project.recentEvents")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("project.col.time")}</th>
                <th className="pb-3">{t("project.col.source")}</th>
                <th className="pb-3">{t("project.col.model")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.totalRaw")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.input")}</th>
                <th className="pb-3 pr-4 text-right">{t("project.col.output")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTimeSeconds(event.occurredAt, tz)}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300"><ModelLink model={event.model} fallback={t("project.unknownModel")} /></td>
                  <td className="py-2.5 pr-4 text-right">{formatFullNumber(event.totalTokens)}</td>
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
