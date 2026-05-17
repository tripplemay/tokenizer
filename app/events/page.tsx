import { prisma } from "@/server/db";
import Card from "@/components/card";
import { SourcePill } from "../_components/source-pill";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: Date) {
  return value.toISOString().replace("T", " ").slice(0, 19);
}

export default async function EventsPage() {
  const events = await prisma.usageEvent.findMany({
    take: 200,
    orderBy: { occurredAt: "desc" },
    include: { project: true }
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">Events</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Latest {events.length} raw usage events. Per-event token figures are the stored cumulative values; the dashboard's billable totals strip cache reads.</p>
      </div>
      <Card extra="p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-3">Time</th>
                <th className="pb-3">Project</th>
                <th className="pb-3">Source</th>
                <th className="pb-3">Model</th>
                <th className="pb-3 text-right">Total (raw)</th>
                <th className="pb-3 text-right">Input</th>
                <th className="pb-3 text-right">Output</th>
                <th className="pb-3 text-right">Cache</th>
                <th className="pb-3 text-right">Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-gray-200 text-navy-700 dark:border-white/10 dark:text-white">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-500 dark:text-gray-400">{formatDateTime(event.occurredAt)}</td>
                  <td className="py-2.5 pr-4 font-medium">{event.project?.name ?? "Unknown"}</td>
                  <td className="py-2.5 pr-4"><SourcePill source={event.source} /></td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{event.model ?? "unknown"}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.totalTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.inputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.outputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.cachedInputTokens)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(event.reasoningOutputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
