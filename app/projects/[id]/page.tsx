import Link from "next/link";
import { MdArrowBack, MdBolt, MdInput, MdOutput } from "react-icons/md";
import { prisma } from "@/server/db";
import Card from "@/components/card";
import Widget from "@/components/widget/Widget";
import { SourcePill } from "../../_components/source-pill";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: Date) {
  return value.toISOString().replace("T", " ").slice(0, 19);
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  const [totals, events, bySource, byModel] = await Promise.all([
    prisma.usageEvent.aggregate({ where: { projectId: id }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true } }),
    prisma.usageEvent.findMany({ where: { projectId: id }, take: 100, orderBy: { occurredAt: "desc" } }),
    prisma.usageEvent.groupBy({ by: ["source"], where: { projectId: id }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true }, _count: true }),
    prisma.usageEvent.groupBy({ by: ["model"], where: { projectId: id }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true }, _count: true })
  ]);

  if (!project) {
    return (
      <div className="space-y-5">
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          Back to overview
        </Link>
        <Card extra="p-6">
          <p className="text-navy-700 dark:text-white">Project not found.</p>
        </Card>
      </div>
    );
  }

  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const billableTokens = inputTokens + outputTokens;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
          <MdArrowBack className="h-4 w-4" />
          Back to overview
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">{project.name}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{project.workspacePath ?? "No workspace path"}</p>
        <p className="mt-0.5 text-xs text-gray-500">Aggregate metrics exclude cache reuse; per-event rows below show raw stored totals.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Widget icon={<MdBolt className="h-7 w-7" />} title="Total" subtitle={formatNumber(billableTokens)} />
        <Widget icon={<MdInput className="h-7 w-7" />} title="Input" subtitle={formatNumber(inputTokens)} />
        <Widget icon={<MdOutput className="h-7 w-7" />} title="Output" subtitle={formatNumber(outputTokens)} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card extra="p-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">Sources</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">Source</th>
                <th className="pb-3 text-right">Tokens</th>
                <th className="pb-3 text-right">Events</th>
              </tr>
            </thead>
            <tbody>
              {bySource.map((row) => {
                const billable = (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0);
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
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">Models</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">Model</th>
                <th className="pb-3 text-right">Tokens</th>
                <th className="pb-3 text-right">Events</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => {
                const billable = (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0);
                return (
                  <tr key={row.model ?? "unknown"} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                    <td className="py-2.5 pr-4 font-medium">{row.model ?? "Unknown model"}</td>
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
        <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">Recent Events</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">Time</th>
                <th className="pb-3">Source</th>
                <th className="pb-3">Model</th>
                <th className="pb-3 text-right">Total (raw)</th>
                <th className="pb-3 text-right">Input</th>
                <th className="pb-3 text-right">Output</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500">{formatDateTime(event.occurredAt)}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{event.model ?? "unknown"}</td>
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
