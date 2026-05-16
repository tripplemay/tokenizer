import { prisma } from "./db";
import { computeSummaryMetrics } from "./summary-metrics";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getSummary() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, todayAgg, weekAgg, monthAgg, eventCount, projectCount, deviceCount, lastEvent, unknownProject, unknownModel] = await Promise.all([
    prisma.usageEvent.aggregate({ _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, reasoningOutputTokens: true } }),
    prisma.usageEvent.aggregate({ where: { occurredAt: { gte: today } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.aggregate({ where: { occurredAt: { gte: week } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.aggregate({ where: { occurredAt: { gte: month } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.count(),
    prisma.project.count(),
    prisma.device.count(),
    prisma.usageEvent.findFirst({ orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    prisma.usageEvent.aggregate({ where: { project: { name: "Unknown Project" } }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true } }),
    prisma.usageEvent.aggregate({ where: { model: null }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true } })
  ]);

  const inputTokens = total._sum.inputTokens ?? 0;
  const outputTokens = total._sum.outputTokens ?? 0;
  const cachedInputTokens = total._sum.cachedInputTokens ?? 0;
  const metrics = computeSummaryMetrics({ inputTokens, outputTokens, cachedInputTokens });

  return {
    totalTokens: total._sum.totalTokens ?? 0,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens: total._sum.reasoningOutputTokens ?? 0,
    billableTokens: metrics.billableTokens,
    cacheHitRate: metrics.cacheHitRate,
    todayTokens: todayAgg._sum.totalTokens ?? 0,
    weekTokens: weekAgg._sum.totalTokens ?? 0,
    monthTokens: monthAgg._sum.totalTokens ?? 0,
    eventCount,
    projectCount,
    deviceCount,
    lastEventAt: lastEvent?.occurredAt?.toISOString() ?? null,
    unknownProjectTokens: unknownProject._sum.totalTokens ?? 0,
    unknownProjectBillable: (unknownProject._sum.inputTokens ?? 0) + (unknownProject._sum.outputTokens ?? 0),
    unknownModelTokens: unknownModel._sum.totalTokens ?? 0,
    unknownModelBillable: (unknownModel._sum.inputTokens ?? 0) + (unknownModel._sum.outputTokens ?? 0)
  };
}

export async function getDeviceSummary() {
  const rows = await prisma.usageEvent.groupBy({
    by: ["deviceId"],
    _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
    _count: true,
    _max: { occurredAt: true },
    orderBy: { _sum: { totalTokens: "desc" } }
  });
  const devices = await prisma.device.findMany();
  const rowByDeviceId = new Map(rows.map((row) => [row.deviceId, row]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const ids = new Set([...devices.map((device) => device.id), ...rows.map((row) => row.deviceId)]);
  return Array.from(ids).map((deviceId) => {
    const row = rowByDeviceId.get(deviceId);
    const device = deviceById.get(deviceId);
    const inputTokens = row?._sum.inputTokens ?? 0;
    const outputTokens = row?._sum.outputTokens ?? 0;
    return {
      deviceId,
      name: device?.name ?? deviceId,
      hostname: device?.hostname ?? null,
      platform: device?.platform ?? null,
      lastSeenAt: device?.lastSeenAt?.toISOString() ?? null,
      lastSyncAt: device?.lastSyncAt?.toISOString() ?? null,
      lastEventAt: row?._max.occurredAt?.toISOString() ?? null,
      totalTokens: row?._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      billableTokens: inputTokens + outputTokens,
      events: row?._count ?? 0
    };
  });
}

export async function getProjectSummary() {
  const rows = await prisma.usageEvent.groupBy({
    by: ["projectId"],
    _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
    _max: { occurredAt: true },
    _count: true,
    orderBy: { _sum: { totalTokens: "desc" } },
    take: 20
  });
  const projects = await prisma.project.findMany({ where: { id: { in: rows.map((row) => row.projectId).filter(Boolean) as string[] } } });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return rows.map((row) => {
    const inputTokens = row._sum.inputTokens ?? 0;
    const outputTokens = row._sum.outputTokens ?? 0;
    const billableTokens = inputTokens + outputTokens;
    return {
      projectId: row.projectId,
      name: row.projectId ? projectById.get(row.projectId)?.name ?? "Unknown Project" : "Unknown Project",
      workspacePath: row.projectId ? projectById.get(row.projectId)?.workspacePath ?? null : null,
      totalTokens: row._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      billableTokens,
      events: row._count,
      avgTokensPerEvent: row._count > 0 ? Math.round((row._sum.totalTokens ?? 0) / row._count) : 0,
      avgBillablePerEvent: row._count > 0 ? Math.round(billableTokens / row._count) : 0,
      lastActiveAt: row._max.occurredAt?.toISOString() ?? null
    };
  });
}

// Reporting timezone for daily bucket boundaries. Hardcoded for now because the
// PRD scopes Tokenizer to a single user; revisit when multi-tenant support is
// on the table.
const REPORTING_TIMEZONE = "Asia/Shanghai";

type DailySummaryRow = {
  date: Date | string;
  totalTokens: bigint | number | null;
  inputTokens: bigint | number | null;
  outputTokens: bigint | number | null;
  billableTokens: bigint | number | null;
};

function bucketDateToIso(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function bigintToNumber(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

export async function getDailySummary(days = 180) {
  const since = new Date(Date.now() - days * DAY_MS);

  // Aggregate in Postgres rather than loading every event into Node memory, and
  // bucket by REPORTING_TIMEZONE so the "today" boundary on the chart matches
  // the user's local perception instead of UTC midnight.
  const rows = await prisma.$queryRaw<DailySummaryRow[]>`
    SELECT
      date_trunc('day', "occurredAt" AT TIME ZONE ${REPORTING_TIMEZONE})::date AS date,
      SUM("totalTokens")::bigint AS "totalTokens",
      SUM("inputTokens")::bigint AS "inputTokens",
      SUM("outputTokens")::bigint AS "outputTokens",
      SUM("inputTokens" + "outputTokens")::bigint AS "billableTokens"
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map((row) => ({
    date: bucketDateToIso(row.date),
    totalTokens: bigintToNumber(row.totalTokens),
    inputTokens: bigintToNumber(row.inputTokens),
    outputTokens: bigintToNumber(row.outputTokens),
    billableTokens: bigintToNumber(row.billableTokens)
  }));
}

export async function getBreakdown(field: "source" | "model") {
  const rows = await prisma.usageEvent.groupBy({
    by: [field],
    _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
    _count: true,
    orderBy: { _sum: { totalTokens: "desc" } },
    take: 20
  });
  return rows.map((row) => {
    const inputTokens = row._sum.inputTokens ?? 0;
    const outputTokens = row._sum.outputTokens ?? 0;
    const billableTokens = inputTokens + outputTokens;
    return {
      name: String(row[field] ?? "unknown"),
      totalTokens: row._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      billableTokens,
      events: row._count,
      avgTokensPerEvent: row._count > 0 ? Math.round((row._sum.totalTokens ?? 0) / row._count) : 0,
      avgBillablePerEvent: row._count > 0 ? Math.round(billableTokens / row._count) : 0
    };
  });
}
