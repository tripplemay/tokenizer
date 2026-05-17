import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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

  if (!project) return <div>Project not found</div>;

  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const billableTokens = inputTokens + outputTokens;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{project.name}</h1>
        <p className="mt-2 text-slate-400">{project.workspacePath ?? "No workspace path"}</p>
        <p className="mt-1 text-xs text-slate-600">Aggregate metrics exclude cache reuse; per-event rows below show raw stored totals.</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="Total" value={billableTokens} helper="Input + Output" />
        <Metric label="Input" value={inputTokens} />
        <Metric label="Output" value={outputTokens} />
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Sources" rows={bySource.map((row) => ({ name: row.source, billableTokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0), events: row._count }))} />
        <Breakdown title="Models" rows={byModel.map((row) => ({ name: row.model ?? "unknown", billableTokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0), events: row._count }))} />
      </section>
      <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/70">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th className="p-3">Time</th><th>Source</th><th>Model</th><th>Total (raw)</th><th>Input</th><th>Output</th></tr></thead>
          <tbody>{events.map((event) => <tr key={event.id} className="border-t border-slate-800"><td className="p-3">{event.occurredAt.toISOString()}</td><td>{event.source}</td><td>{event.model ?? "unknown"}</td><td>{formatNumber(event.totalTokens)}</td><td>{formatNumber(event.inputTokens)}</td><td>{formatNumber(event.outputTokens)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, helper }: { label: string; value: number; helper?: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{formatNumber(value)}</div>
      {helper ? <div className="mt-2 text-xs text-slate-500">{helper}</div> : null}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; billableTokens: number; events: number }[] }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5"><h2 className="mb-4 text-xl font-semibold">{title}</h2><table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th>Name</th><th>Tokens</th><th>Events</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name} className="border-t border-slate-800"><td className="py-3">{row.name}</td><td>{formatNumber(row.billableTokens)}</td><td>{row.events}</td></tr>)}</tbody></table></div>;
}
