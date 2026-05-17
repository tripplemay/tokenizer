import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MdArrowBack, MdBolt, MdInput, MdOutput, MdCached } from "react-icons/md";
import { prisma } from "@/server/db";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { formatDateTimeSeconds } from "@/shared/format";
import { SourcePill } from "../../_components/source-pill";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, project, totals, events, bySource, byModel] = await Promise.all([
    getTranslations(),
    prisma.project.findUnique({ where: { id } }),
    prisma.usageEvent.aggregate({ where: { projectId: id }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true } }),
    prisma.usageEvent.findMany({ where: { projectId: id }, take: 100, orderBy: { occurredAt: "desc" } }),
    prisma.usageEvent.groupBy({ by: ["source"], where: { projectId: id }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true }, _count: true }),
    prisma.usageEvent.groupBy({ by: ["model"], where: { projectId: id }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true }, _count: true })
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

  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const cachedInputTokens = totals._sum.cachedInputTokens ?? 0;
  const billableTokens = Math.max(0, inputTokens - cachedInputTokens) + outputTokens;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          {t("project.back")}
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">{project.name}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{project.workspacePath ?? t("project.noWorkspace")}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("project.aggregateNote")}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("timezone.note")}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Widget icon={<MdInput className="h-7 w-7" />} title={t("project.metric.input")} subtitle={formatNumber(inputTokens)} />
        <Widget icon={<MdCached className="h-7 w-7" />} title={t("project.metric.cacheRead")} subtitle={formatNumber(cachedInputTokens)} />
        <Widget icon={<MdOutput className="h-7 w-7" />} title={t("project.metric.output")} subtitle={formatNumber(outputTokens)} />
        <Widget icon={<MdBolt className="h-7 w-7" />} title={t("project.metric.compute")} subtitle={formatNumber(billableTokens)} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("project.sources")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("project.col.source")}</th>
                <th className="pb-3 text-right">{t("project.col.tokens")}</th>
                <th className="pb-3 text-right">{t("project.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {bySource.map((row) => {
                const billable = Math.max(0, (row._sum.inputTokens ?? 0) - (row._sum.cachedInputTokens ?? 0)) + (row._sum.outputTokens ?? 0);
                return (
                  <tr key={row.source} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4"><SourcePill source={row.source} /></td>
                    <td className="py-2.5 pr-4 text-right">{formatNumber(billable)}</td>
                    <td className="py-2.5 pr-4 text-right">{row._count}</td>
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
                <th className="pb-3 text-right">{t("project.col.tokens")}</th>
                <th className="pb-3 text-right">{t("project.col.events")}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => {
                const billable = Math.max(0, (row._sum.inputTokens ?? 0) - (row._sum.cachedInputTokens ?? 0)) + (row._sum.outputTokens ?? 0);
                return (
                  <tr key={row.model ?? "unknown"} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium">{row.model ?? t("project.unknownModel")}</td>
                    <td className="py-2.5 pr-4 text-right">{formatNumber(billable)}</td>
                    <td className="py-2.5 pr-4 text-right">{row._count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card extra="p-6">
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">{t("project.recentEvents")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">{t("project.col.time")}</th>
                <th className="pb-3">{t("project.col.source")}</th>
                <th className="pb-3">{t("project.col.model")}</th>
                <th className="pb-3 text-right">{t("project.col.totalRaw")}</th>
                <th className="pb-3 text-right">{t("project.col.input")}</th>
                <th className="pb-3 text-right">{t("project.col.output")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTimeSeconds(event.occurredAt)}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{event.model ?? t("project.unknownModel")}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.totalTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.inputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
