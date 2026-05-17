import { prisma } from "./db";
import { computeSummaryMetrics } from "./summary-metrics";
import { estimateCost, sumCostAcrossModels } from "@/shared/model-pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

// New convention: inputTokens (DB) is the total input the model saw
// (raw + cache_write + cache_read). billableTokens is the "fresh" portion:
//   billable = (inputTokens - cachedInputTokens) + outputTokens
// Using Math.max guards against any stale rows where inputTokens < cached.
function billableOf(inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  const fresh = Math.max(0, inputTokens - cachedInputTokens);
  return fresh + outputTokens;
}

// Token aggregates grouped by model. Used downstream by costFor… helpers to
// compute USD totals for any "scope" (overall, per project, per source, …).
type CostGroup = {
  model: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

function sumNumeric(value: number | bigint | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

// One-shot cost aggregation across an arbitrary WHERE. Prisma `groupBy({ by: ["model"] })`
// gives us the per-model token rollup; we then walk the rows and apply the
// per-model unit price.
async function costForWhere(where: Record<string, unknown>): Promise<number> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["model"],
    where,
    _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
  });
  return rows.reduce((total, row) => {
    const c = estimateCost(row.model, {
      inputTokens: row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0
    });
    return total + (c ?? 0);
  }, 0);
}

// Rolling 7-day "this week" vs "previous 7 days" baseline. Anchored to now so
// hour-of-day differences don't slosh events across the boundary.
type WeekWindow = { gte: Date; lt: Date };
function rollingWeekWindows(now: Date): { current: WeekWindow; previous: WeekWindow } {
  const current: WeekWindow = { gte: new Date(now.getTime() - 7 * DAY_MS), lt: now };
  const previous: WeekWindow = { gte: new Date(now.getTime() - 14 * DAY_MS), lt: current.gte };
  return { current, previous };
}

async function computeAndCostFor(where: Record<string, unknown>): Promise<{ compute: number; cost: number }> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["model"],
    where,
    _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
  });
  let compute = 0;
  let cost = 0;
  for (const row of rows) {
    const i = row._sum.inputTokens ?? 0;
    const c = row._sum.cachedInputTokens ?? 0;
    const o = row._sum.outputTokens ?? 0;
    const w = row._sum.cacheWriteTokens ?? 0;
    compute += billableOf(i, c, o);
    const dollars = estimateCost(row.model, { inputTokens: i, cachedInputTokens: c, cacheWriteTokens: w, outputTokens: o });
    if (dollars != null) cost += dollars;
  }
  return { compute, cost };
}

export async function getSummary() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const windows = rollingWeekWindows(now);

  const [
    total,
    todayAgg,
    weekAgg,
    monthAgg,
    eventCount,
    projectCount,
    deviceCount,
    lastEvent,
    unknownProject,
    unknownModel,
    costByModel,
    currentWeek,
    previousWeek
  ] = await Promise.all([
    prisma.usageEvent.aggregate({ _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, reasoningOutputTokens: true } }),
    prisma.usageEvent.aggregate({ where: { occurredAt: { gte: today } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.aggregate({ where: { occurredAt: { gte: week } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.aggregate({ where: { occurredAt: { gte: month } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.count(),
    prisma.project.count(),
    prisma.device.count(),
    prisma.usageEvent.findFirst({ orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    prisma.usageEvent.aggregate({ where: { project: { name: "Unknown Project" } }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true } }),
    prisma.usageEvent.aggregate({ where: { model: null }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true } }),
    prisma.usageEvent.groupBy({ by: ["model"], _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true } }),
    computeAndCostFor({ occurredAt: { gte: windows.current.gte, lt: windows.current.lt } }),
    computeAndCostFor({ occurredAt: { gte: windows.previous.gte, lt: windows.previous.lt } })
  ]);

  const inputTokens = total._sum.inputTokens ?? 0;
  const outputTokens = total._sum.outputTokens ?? 0;
  const cachedInputTokens = total._sum.cachedInputTokens ?? 0;
  const cacheWriteTokens = total._sum.cacheWriteTokens ?? 0;
  const metrics = computeSummaryMetrics({ inputTokens, outputTokens, cachedInputTokens });

  const { cost: totalCost, unpricedTokens } = sumCostAcrossModels(
    costByModel.map((row) => ({
      model: row.model,
      inputTokens: row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0
    }))
  );

  return {
    totalTokens: total._sum.totalTokens ?? 0,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    reasoningOutputTokens: total._sum.reasoningOutputTokens ?? 0,
    billableTokens: metrics.billableTokens,
    cacheHitRate: metrics.cacheHitRate,
    totalCost,
    unpricedTokens,
    todayTokens: todayAgg._sum.totalTokens ?? 0,
    weekTokens: weekAgg._sum.totalTokens ?? 0,
    monthTokens: monthAgg._sum.totalTokens ?? 0,
    currentWeekCompute: currentWeek.compute,
    currentWeekCost: currentWeek.cost,
    previousWeekCompute: previousWeek.compute,
    previousWeekCost: previousWeek.cost,
    eventCount,
    projectCount,
    deviceCount,
    lastEventAt: lastEvent?.occurredAt?.toISOString() ?? null,
    unknownProjectTokens: unknownProject._sum.totalTokens ?? 0,
    unknownProjectBillable: billableOf(unknownProject._sum.inputTokens ?? 0, unknownProject._sum.cachedInputTokens ?? 0, unknownProject._sum.outputTokens ?? 0),
    unknownModelTokens: unknownModel._sum.totalTokens ?? 0,
    unknownModelBillable: billableOf(unknownModel._sum.inputTokens ?? 0, unknownModel._sum.cachedInputTokens ?? 0, unknownModel._sum.outputTokens ?? 0)
  };
}

export async function getDeviceSummary() {
  const rows = await prisma.usageEvent.groupBy({
    by: ["deviceId"],
    _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
    _count: true,
    _max: { occurredAt: true },
    orderBy: { _sum: { totalTokens: "desc" } }
  });
  // Per-device cost requires the (deviceId, model) cross-section because a
  // device can use multiple models, each with different pricing.
  const costRows = await prisma.usageEvent.groupBy({
    by: ["deviceId", "model"],
    _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
  });
  const costByDevice = new Map<string, number>();
  for (const row of costRows) {
    const c = estimateCost(row.model, {
      inputTokens: row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0
    });
    if (c == null) continue;
    costByDevice.set(row.deviceId, (costByDevice.get(row.deviceId) ?? 0) + c);
  }
  const devices = await prisma.device.findMany();
  const rowByDeviceId = new Map(rows.map((row) => [row.deviceId, row]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const ids = new Set([...devices.map((device) => device.id), ...rows.map((row) => row.deviceId)]);
  return Array.from(ids).map((deviceId) => {
    const row = rowByDeviceId.get(deviceId);
    const device = deviceById.get(deviceId);
    const inputTokens = row?._sum.inputTokens ?? 0;
    const outputTokens = row?._sum.outputTokens ?? 0;
    const cachedInputTokens = row?._sum.cachedInputTokens ?? 0;
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
      cachedInputTokens,
      cacheWriteTokens: row?._sum.cacheWriteTokens ?? 0,
      billableTokens: billableOf(inputTokens, cachedInputTokens, outputTokens),
      cost: costByDevice.get(deviceId) ?? 0,
      events: row?._count ?? 0
    };
  });
}

export async function getProjectSummary() {
  const [rows, costRows] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: ["projectId"],
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _max: { occurredAt: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    }),
    // (projectId, model) groupBy gives the slice needed to apply per-model
    // pricing and then collapse back to a per-project cost total.
    prisma.usageEvent.groupBy({
      by: ["projectId", "model"],
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    })
  ]);
  const costByProject = new Map<string, number>();
  for (const row of costRows) {
    const key = row.projectId ?? "__null__";
    const c = estimateCost(row.model, {
      inputTokens: row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0
    });
    if (c == null) continue;
    costByProject.set(key, (costByProject.get(key) ?? 0) + c);
  }
  const projects = await prisma.project.findMany({ where: { id: { in: rows.map((row) => row.projectId).filter(Boolean) as string[] } } });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return rows.map((row) => {
    const inputTokens = row._sum.inputTokens ?? 0;
    const outputTokens = row._sum.outputTokens ?? 0;
    const cachedInputTokens = row._sum.cachedInputTokens ?? 0;
    const billableTokens = billableOf(inputTokens, cachedInputTokens, outputTokens);
    return {
      projectId: row.projectId,
      name: row.projectId ? projectById.get(row.projectId)?.name ?? "Unknown Project" : "Unknown Project",
      workspacePath: row.projectId ? projectById.get(row.projectId)?.workspacePath ?? null : null,
      totalTokens: row._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      billableTokens,
      cost: costByProject.get(row.projectId ?? "__null__") ?? 0,
      events: row._count,
      avgTokensPerEvent: row._count > 0 ? Math.round((row._sum.totalTokens ?? 0) / row._count) : 0,
      avgBillablePerEvent: row._count > 0 ? Math.round(billableTokens / row._count) : 0,
      lastActiveAt: row._max.occurredAt?.toISOString() ?? null
    };
  });
}

// Per-project (and its sub-tables) need their own model breakdown too — used
// by /projects/[id] to fill Sources / Models tables with cost columns.
export async function getProjectDetail(projectId: string) {
  const [totals, events, bySource, byModel, sourceCostRows, modelCostRows, projectCost] = await Promise.all([
    prisma.usageEvent.aggregate({
      where: { projectId },
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true }
    }),
    prisma.usageEvent.findMany({ where: { projectId }, take: 100, orderBy: { occurredAt: "desc" } }),
    prisma.usageEvent.groupBy({
      by: ["source"],
      where: { projectId },
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where: { projectId },
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true
    }),
    prisma.usageEvent.groupBy({
      by: ["source", "model"],
      where: { projectId },
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where: { projectId },
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    costForWhere({ projectId })
  ]);

  const costBySource = new Map<string, number>();
  for (const row of sourceCostRows) {
    const c = estimateCost(row.model, {
      inputTokens: row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0
    });
    if (c == null) continue;
    costBySource.set(row.source, (costBySource.get(row.source) ?? 0) + c);
  }
  const costByModelMap = new Map<string, number>();
  for (const row of modelCostRows) {
    const c = estimateCost(row.model, {
      inputTokens: row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0
    });
    if (c == null) continue;
    costByModelMap.set(row.model ?? "__null__", (costByModelMap.get(row.model ?? "__null__") ?? 0) + c);
  }

  return {
    totals,
    events,
    bySource: bySource.map((row) => ({ ...row, cost: costBySource.get(row.source) ?? 0 })),
    byModel: byModel.map((row) => ({ ...row, cost: costByModelMap.get(row.model ?? "__null__") ?? 0 })),
    projectCost
  };
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
  cachedInputTokens: bigint | number | null;
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

  const rows = await prisma.$queryRaw<DailySummaryRow[]>`
    SELECT
      date_trunc('day', "occurredAt" AT TIME ZONE ${REPORTING_TIMEZONE})::date AS date,
      SUM("totalTokens")::bigint AS "totalTokens",
      SUM("inputTokens")::bigint AS "inputTokens",
      SUM("outputTokens")::bigint AS "outputTokens",
      SUM("cachedInputTokens")::bigint AS "cachedInputTokens",
      SUM(GREATEST("inputTokens" - "cachedInputTokens", 0) + "outputTokens")::bigint AS "billableTokens"
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
    cachedInputTokens: bigintToNumber(row.cachedInputTokens),
    billableTokens: bigintToNumber(row.billableTokens)
  }));
}

export async function getBreakdown(field: "source" | "model") {
  const [rows, costRows] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: [field],
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    }),
    // (field, model) gives us the price-aware slice. When field === "model"
    // it collapses to the same shape we'd compute directly; we still go
    // through the same path for symmetry.
    prisma.usageEvent.groupBy({
      by: [field, "model"],
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    })
  ]);
  const costByKey = new Map<string, number>();
  for (const row of costRows) {
    const key = String(row[field] ?? "unknown");
    const c = estimateCost(row.model, {
      inputTokens: sumNumeric(row._sum.inputTokens),
      cachedInputTokens: sumNumeric(row._sum.cachedInputTokens),
      cacheWriteTokens: sumNumeric(row._sum.cacheWriteTokens),
      outputTokens: sumNumeric(row._sum.outputTokens)
    });
    if (c == null) continue;
    costByKey.set(key, (costByKey.get(key) ?? 0) + c);
  }
  return rows.map((row) => {
    const inputTokens = row._sum.inputTokens ?? 0;
    const outputTokens = row._sum.outputTokens ?? 0;
    const cachedInputTokens = row._sum.cachedInputTokens ?? 0;
    const billableTokens = billableOf(inputTokens, cachedInputTokens, outputTokens);
    const key = String(row[field] ?? "unknown");
    return {
      name: key,
      totalTokens: row._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
      billableTokens,
      cost: costByKey.get(key) ?? 0,
      events: row._count,
      avgTokensPerEvent: row._count > 0 ? Math.round((row._sum.totalTokens ?? 0) / row._count) : 0,
      avgBillablePerEvent: row._count > 0 ? Math.round(billableTokens / row._count) : 0
    };
  });
}
