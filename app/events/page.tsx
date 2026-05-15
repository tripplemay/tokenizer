import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function EventsPage() {
  const events = await prisma.usageEvent.findMany({ take: 200, orderBy: { occurredAt: "desc" }, include: { project: true } });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Events</h1>
        <p className="mt-2 text-slate-400">Latest raw usage events.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/70">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th className="p-3">Time</th><th>Project</th><th>Source</th><th>Model</th><th>Total</th><th>Input</th><th>Output</th><th>Cache</th><th>Reasoning</th></tr></thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-slate-800">
                <td className="p-3 whitespace-nowrap">{event.occurredAt.toISOString()}</td>
                <td>{event.project?.name ?? "Unknown"}</td>
                <td>{event.source}</td>
                <td>{event.model ?? "unknown"}</td>
                <td>{formatNumber(event.totalTokens)}</td>
                <td>{formatNumber(event.inputTokens)}</td>
                <td>{formatNumber(event.outputTokens)}</td>
                <td>{formatNumber(event.cachedInputTokens)}</td>
                <td>{formatNumber(event.reasoningOutputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
