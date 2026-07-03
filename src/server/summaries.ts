import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import { computeSummaryMetrics } from "./summary-metrics";
import { decomposeCost, estimateCost, getModelPrice, sumCostAcrossModels } from "@/shared/model-pricing";
import { bucketKeys, granularityForSpan, sqlBucket } from "./time-buckets";

// Short-TTL cache for the dashboard's expensive aggregates. Each summary
// function is wrapped at the bottom of this file; arguments form part of
// the cache key automatically. 30s strikes a balance between live updates
// (events arrive within a 60s heartbeat window) and avoiding repeated
// multi-second cold reads when the user navigates between pages.
const CACHE_REVALIDATE_SECONDS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RangeOption = "7d" | "30d" | "all";
export type ProjectFilter = "all" | "gitOnly";

// Range filter helpers. "all" returns undefined so a caller can spread it into
// a where clause without leaking an unbounded `occurredAt`.
function rangeStart(range: RangeOption): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * DAY_MS);
}

function rangeWhere(range: RangeOption, tenantId: string): Record<string, unknown> {
  const since = rangeStart(range);
  return since ? { userId: tenantId, occurredAt: { gte: since } } : { userId: tenantId };
}

// Equal-length prior window for WoW comparison. Returns null for "all" since
// there is no natural "prior" baseline for an unbounded view.
function priorWindow(range: RangeOption, now: Date): { gte: Date; lt: Date } | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  const gte = new Date(now.getTime() - 2 * days * DAY_MS);
  const lt = new Date(now.getTime() - days * DAY_MS);
  return { gte, lt };
}

// New convention: inputTokens (DB) is the total input the model saw
// (raw + cache_write + cache_read). billableTokens is the "fresh" portion:
//   billable = (inputTokens - cachedInputTokens) + outputTokens
// Using Math.max guards against any stale rows where inputTokens < cached.
function billableOf(inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  const fresh = Math.max(0, inputTokens - cachedInputTokens);
  return fresh + outputTokens;
}

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

async function getSummaryImpl(tenantId: string, range: RangeOption = "all") {
  const now = new Date();
  const where = rangeWhere(range, tenantId);
  const prior = priorWindow(range, now);

  const [
    total,
    eventCount,
    activeProjectIds,
    activeDeviceIds,
    lastEvent,
    unknownProject,
    unknownModel,
    costByModel,
    fallbackAgg,
    priorMetrics
  ] = await Promise.all([
    prisma.usageEvent.aggregate({ where, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, reasoningOutputTokens: true } }),
    prisma.usageEvent.count({ where }),
    prisma.usageEvent.groupBy({ by: ["projectId"], where, _count: true }),
    prisma.usageEvent.groupBy({ by: ["deviceId"], where, _count: true }),
    prisma.usageEvent.findFirst({ where: { userId: tenantId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    prisma.usageEvent.aggregate({ where: { ...where, project: { name: "Unknown Project" } }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true } }),
    prisma.usageEvent.aggregate({ where: { ...where, model: null }, _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true } }),
    prisma.usageEvent.groupBy({ by: ["model"], where, _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true } }),
    // One row per mid-request model downgrade: the final event of a fallback
    // carries fallbackFromModel (the segment events carry fallbackToModel and
    // would double-count occurrences).
    prisma.usageEvent.count({ where: { ...where, fallbackFromModel: { not: null } } }),
    prior ? computeAndCostFor({ userId: tenantId, occurredAt: { gte: prior.gte, lt: prior.lt } }) : Promise.resolve(null)
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
    range,
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
    priorCompute: priorMetrics?.compute ?? null,
    priorCost: priorMetrics?.cost ?? null,
    eventCount,
    projectCount: activeProjectIds.length,
    deviceCount: activeDeviceIds.length,
    lastEventAt: lastEvent?.occurredAt?.toISOString() ?? null,
    unknownProjectTokens: unknownProject._sum.totalTokens ?? 0,
    unknownProjectBillable: billableOf(unknownProject._sum.inputTokens ?? 0, unknownProject._sum.cachedInputTokens ?? 0, unknownProject._sum.outputTokens ?? 0),
    unknownModelTokens: unknownModel._sum.totalTokens ?? 0,
    unknownModelBillable: billableOf(unknownModel._sum.inputTokens ?? 0, unknownModel._sum.cachedInputTokens ?? 0, unknownModel._sum.outputTokens ?? 0),
    fallbackEvents: fallbackAgg
  };
}

async function getDeviceSummaryImpl(tenantId: string, range: RangeOption = "all") {
  const where = rangeWhere(range, tenantId);
  const rows = await prisma.usageEvent.groupBy({
    by: ["deviceId"],
    where,
    _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, reasoningOutputTokens: true },
    _count: true,
    _max: { occurredAt: true },
    orderBy: { _sum: { totalTokens: "desc" } }
  });
  const costRows = await prisma.usageEvent.groupBy({
    by: ["deviceId", "model"],
    where,
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
  const devices = await prisma.device.findMany({ where: { userId: tenantId } });
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
      agentVersion: device?.agentVersion ?? null,
      agentFeatureVersion: device?.agentFeatureVersion ?? null,
      queueDepth: device?.queueDepth ?? null,
      lastError: device?.lastError ?? null,
      lastErrorAt: device?.lastErrorAt?.toISOString() ?? null,
      lastSyncStatus: device?.lastSyncStatus ?? null,
      totalTokens: row?._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens: row?._sum.cacheWriteTokens ?? 0,
      reasoningOutputTokens: row?._sum.reasoningOutputTokens ?? 0,
      billableTokens: billableOf(inputTokens, cachedInputTokens, outputTokens),
      cacheHitRate: inputTokens > 0 ? Math.min(1, cachedInputTokens / inputTokens) : 0,
      cost: costByDevice.get(deviceId) ?? 0,
      events: row?._count ?? 0
    };
  });
}

// Detail rollup for a single device. Mirrors getProjectDetail() in shape so
// /devices/[id] can reuse the same table layouts.
export async function getDeviceDetail(tenantId: string, deviceId: string, range: RangeOption = "all") {
  const where = { deviceId, ...rangeWhere(range, tenantId) };
  const [device, totals, eventCount, events, byProject, byModel, bySource, projectCostRows, modelCostRows, sourceCostRows, deviceCost] = await Promise.all([
    prisma.device.findFirst({ where: { id: deviceId, userId: tenantId } }),
    prisma.usageEvent.aggregate({
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, reasoningOutputTokens: true }
    }),
    prisma.usageEvent.count({ where }),
    prisma.usageEvent.findMany({ where, take: 100, orderBy: { occurredAt: "desc" } }),
    prisma.usageEvent.groupBy({
      by: ["projectId"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } }
    }),
    prisma.usageEvent.groupBy({
      by: ["source"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true
    }),
    prisma.usageEvent.groupBy({
      by: ["projectId", "model"],
      where,
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where,
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    prisma.usageEvent.groupBy({
      by: ["source", "model"],
      where,
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    costForWhere(where)
  ]);

  const costByProject = new Map<string, number>();
  for (const row of projectCostRows) {
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

  // Resolve project names; null projectId rows fall through as "Unknown"
  const projectIds = byProject.map((r) => r.projectId).filter((id): id is string => Boolean(id));
  const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds }, userId: tenantId } }) : [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const cachedInputTokens = totals._sum.cachedInputTokens ?? 0;

  return {
    device,
    totals: {
      totalTokens: totals._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens: totals._sum.cacheWriteTokens ?? 0,
      reasoningOutputTokens: totals._sum.reasoningOutputTokens ?? 0,
      billableTokens: billableOf(inputTokens, cachedInputTokens, outputTokens),
      cacheHitRate: inputTokens > 0 ? Math.min(1, cachedInputTokens / inputTokens) : 0,
      cost: deviceCost,
      eventCount
    },
    events,
    byProject: byProject.map((row) => {
      const project = row.projectId ? projectById.get(row.projectId) : undefined;
      const i = row._sum.inputTokens ?? 0;
      const o = row._sum.outputTokens ?? 0;
      const c = row._sum.cachedInputTokens ?? 0;
      return {
        projectId: row.projectId,
        name: project?.name ?? "Unknown Project",
        repoKey: project?.repoKey ?? null,
        workspacePath: project?.workspacePath ?? null,
        totalTokens: row._sum.totalTokens ?? 0,
        billableTokens: billableOf(i, c, o),
        cost: costByProject.get(row.projectId ?? "__null__") ?? 0,
        events: row._count
      };
    }),
    byModel: byModel.map((row) => {
      const i = row._sum.inputTokens ?? 0;
      const o = row._sum.outputTokens ?? 0;
      const c = row._sum.cachedInputTokens ?? 0;
      return {
        model: row.model,
        totalTokens: row._sum.totalTokens ?? 0,
        inputTokens: i,
        outputTokens: o,
        cachedInputTokens: c,
        billableTokens: billableOf(i, c, o),
        cost: costByModelMap.get(row.model ?? "__null__") ?? 0,
        events: row._count
      };
    }),
    bySource: bySource.map((row) => {
      const i = row._sum.inputTokens ?? 0;
      const o = row._sum.outputTokens ?? 0;
      const c = row._sum.cachedInputTokens ?? 0;
      return {
        source: row.source,
        totalTokens: row._sum.totalTokens ?? 0,
        billableTokens: billableOf(i, c, o),
        cost: costBySource.get(row.source) ?? 0,
        events: row._count
      };
    })
  };
}

// Detail rollup for a single model string. Exact match — date-suffixed variants
// (e.g. claude-haiku-4-5-20251001) drill in as their own page. Mirrors
// getDeviceDetail but adds a by-device breakdown and is scoped to an arbitrary
// [from, to) window. Not cached (returns Prisma Date objects on `events`).
export async function getModelDetail(tenantId: string, model: string, fromMs: number, toMs: number) {
  const where = { userId: tenantId, model, occurredAt: { gte: new Date(fromMs), lt: new Date(toMs) } };
  const [totals, eventCount, events, byProject, byDevice, bySource, fallbackOutRows, fallbackInRows] = await Promise.all([
    prisma.usageEvent.aggregate({
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, reasoningOutputTokens: true }
    }),
    prisma.usageEvent.count({ where }),
    prisma.usageEvent.findMany({ where, take: 100, orderBy: { occurredAt: "desc" } }),
    prisma.usageEvent.groupBy({
      by: ["projectId"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    }),
    prisma.usageEvent.groupBy({
      by: ["deviceId"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    }),
    prisma.usageEvent.groupBy({
      by: ["source"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true
    }),
    // Mid-request fallbacks touching this model. "Out": segments this model
    // started before the request fell back to another model. "In": events
    // this model served after a request fell back from another model.
    prisma.usageEvent.groupBy({
      by: ["fallbackToModel"],
      where: { ...where, fallbackToModel: { not: null } },
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true
    }),
    prisma.usageEvent.groupBy({
      by: ["fallbackFromModel"],
      where: { ...where, fallbackFromModel: { not: null } },
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true
    })
  ]);

  // A single model means one unit price for the whole page, so cost for any
  // token bundle is a direct estimateCost() call (0 when the model is unpriced).
  const costOf = (s: { inputTokens: number | null; cachedInputTokens: number | null; cacheWriteTokens: number | null; outputTokens: number | null }) =>
    estimateCost(model, {
      inputTokens: s.inputTokens ?? 0,
      cachedInputTokens: s.cachedInputTokens ?? 0,
      cacheWriteTokens: s.cacheWriteTokens ?? 0,
      outputTokens: s.outputTokens ?? 0
    }) ?? 0;

  const projectIds = byProject.map((r) => r.projectId).filter((id): id is string => Boolean(id));
  const deviceIds = byDevice.map((r) => r.deviceId);
  const [projects, devices] = await Promise.all([
    projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds }, userId: tenantId } }) : Promise.resolve([]),
    deviceIds.length ? prisma.device.findMany({ where: { id: { in: deviceIds }, userId: tenantId } }) : Promise.resolve([])
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const cachedInputTokens = totals._sum.cachedInputTokens ?? 0;
  const cacheWriteTokens = totals._sum.cacheWriteTokens ?? 0;
  const tokenAggregate = { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens };

  return {
    model,
    price: getModelPrice(model),
    costBreakdown: decomposeCost(model, tokenAggregate),
    totals: {
      totalTokens: totals._sum.totalTokens ?? 0,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      reasoningOutputTokens: totals._sum.reasoningOutputTokens ?? 0,
      billableTokens: billableOf(inputTokens, cachedInputTokens, outputTokens),
      cacheHitRate: inputTokens > 0 ? Math.min(1, cachedInputTokens / inputTokens) : 0,
      cost: estimateCost(model, tokenAggregate) ?? 0,
      eventCount
    },
    events,
    byProject: byProject.map((row) => {
      const project = row.projectId ? projectById.get(row.projectId) : undefined;
      const i = row._sum.inputTokens ?? 0;
      const o = row._sum.outputTokens ?? 0;
      const c = row._sum.cachedInputTokens ?? 0;
      return {
        projectId: row.projectId,
        name: project?.name ?? "Unknown Project",
        repoKey: project?.repoKey ?? null,
        workspacePath: project?.workspacePath ?? null,
        totalTokens: row._sum.totalTokens ?? 0,
        billableTokens: billableOf(i, c, o),
        cost: costOf(row._sum),
        events: row._count
      };
    }),
    byDevice: byDevice.map((row) => {
      const device = deviceById.get(row.deviceId);
      const i = row._sum.inputTokens ?? 0;
      const o = row._sum.outputTokens ?? 0;
      const c = row._sum.cachedInputTokens ?? 0;
      return {
        deviceId: row.deviceId,
        name: device?.name ?? row.deviceId,
        platform: device?.platform ?? null,
        totalTokens: row._sum.totalTokens ?? 0,
        billableTokens: billableOf(i, c, o),
        cost: costOf(row._sum),
        events: row._count
      };
    }),
    bySource: bySource.map((row) => {
      const i = row._sum.inputTokens ?? 0;
      const o = row._sum.outputTokens ?? 0;
      const c = row._sum.cachedInputTokens ?? 0;
      return {
        source: row.source,
        totalTokens: row._sum.totalTokens ?? 0,
        billableTokens: billableOf(i, c, o),
        cost: costOf(row._sum),
        events: row._count
      };
    }),
    fallback: {
      out: fallbackOutRows
        .map((row) => ({
          model: row.fallbackToModel as string,
          events: row._count,
          totalTokens: row._sum.totalTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          billableTokens: billableOf(row._sum.inputTokens ?? 0, row._sum.cachedInputTokens ?? 0, row._sum.outputTokens ?? 0),
          cost: costOf(row._sum)
        }))
        .sort((a, b) => b.events - a.events),
      in: fallbackInRows
        .map((row) => ({
          model: row.fallbackFromModel as string,
          events: row._count,
          totalTokens: row._sum.totalTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          billableTokens: billableOf(row._sum.inputTokens ?? 0, row._sum.cachedInputTokens ?? 0, row._sum.outputTokens ?? 0),
          cost: costOf(row._sum)
        }))
        .sort((a, b) => b.events - a.events)
    }
  };
}

type DailyForModelRow = {
  bucket: string;
  totalTokens: bigint | number | null;
  inputTokens: bigint | number | null;
  outputTokens: bigint | number | null;
  cachedInputTokens: bigint | number | null;
  billableTokens: bigint | number | null;
};

// Token trend for a single model over an arbitrary [from, to) window. Bucket
// granularity (hour/day/week) is derived from the span; gaps are zero-filled
// against bucketKeys() so the chart x-axis spans the whole window.
export async function getDailyForModel(
  tenantId: string,
  model: string,
  fromMs: number,
  toMs: number,
  timezone: string = "Asia/Shanghai",
) {
  const granularity = granularityForSpan(fromMs, toMs);
  const { unit, format } = sqlBucket(granularity);
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const rows = await prisma.$queryRaw<DailyForModelRow[]>`
    SELECT
      to_char(date_trunc(${unit}, ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}), ${format}) AS bucket,
      SUM("totalTokens")::bigint AS "totalTokens",
      SUM("inputTokens")::bigint AS "inputTokens",
      SUM("outputTokens")::bigint AS "outputTokens",
      SUM("cachedInputTokens")::bigint AS "cachedInputTokens",
      SUM(GREATEST("inputTokens" - "cachedInputTokens", 0) + "outputTokens")::bigint AS "billableTokens"
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to} AND "userId" = ${tenantId} AND model = ${model}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return {
    granularity,
    points: bucketKeys(fromMs, toMs, granularity, timezone).map((date) => {
      const row = byBucket.get(date);
      return {
        date,
        totalTokens: row ? bigintToNumber(row.totalTokens) : 0,
        inputTokens: row ? bigintToNumber(row.inputTokens) : 0,
        outputTokens: row ? bigintToNumber(row.outputTokens) : 0,
        cachedInputTokens: row ? bigintToNumber(row.cachedInputTokens) : 0,
        billableTokens: row ? bigintToNumber(row.billableTokens) : 0
      };
    })
  };
}

type DailyForDeviceRow = {
  date: Date | string;
  totalTokens: bigint | number | null;
  inputTokens: bigint | number | null;
  outputTokens: bigint | number | null;
  cachedInputTokens: bigint | number | null;
  billableTokens: bigint | number | null;
};

export async function getDailyForDevice(
  tenantId: string,
  deviceId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
  const days = daysForRange(range);
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.$queryRaw<DailyForDeviceRow[]>`
    SELECT
      date_trunc('day', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS date,
      SUM("totalTokens")::bigint AS "totalTokens",
      SUM("inputTokens")::bigint AS "inputTokens",
      SUM("outputTokens")::bigint AS "outputTokens",
      SUM("cachedInputTokens")::bigint AS "cachedInputTokens",
      SUM(GREATEST("inputTokens" - "cachedInputTokens", 0) + "outputTokens")::bigint AS "billableTokens"
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${since} AND "deviceId" = ${deviceId} AND "userId" = ${tenantId}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  const byDate = new Map<string, DailyForDeviceRow>();
  for (const row of rows) byDate.set(bucketDateToIso(row.date), row);
  // Zero-fill missing days so the chart x-axis always reaches today_local,
  // even on days with no events.
  return localDateRange(timezone, days).map((date) => {
    const row = byDate.get(date);
    return {
      date,
      totalTokens: row ? bigintToNumber(row.totalTokens) : 0,
      inputTokens: row ? bigintToNumber(row.inputTokens) : 0,
      outputTokens: row ? bigintToNumber(row.outputTokens) : 0,
      cachedInputTokens: row ? bigintToNumber(row.cachedInputTokens) : 0,
      billableTokens: row ? bigintToNumber(row.billableTokens) : 0
    };
  });
}

// Cross-device cost chart. Returns dates + per-device series so the stacked
// area chart on /devices can show how each device contributes to daily spend.
type DailyByDeviceRow = {
  date: Date | string;
  deviceId: string;
  model: string | null;
  input: bigint | number | null;
  cached: bigint | number | null;
  cwrite: bigint | number | null;
  output: bigint | number | null;
};

async function getDailyByDeviceImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
  const days = daysForRange(range);
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.$queryRaw<DailyByDeviceRow[]>`
    SELECT
      date_trunc('day', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS date,
      "deviceId",
      model,
      SUM("inputTokens")::bigint AS input,
      SUM("cachedInputTokens")::bigint AS cached,
      SUM("cacheWriteTokens")::bigint AS cwrite,
      SUM("outputTokens")::bigint AS output
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${since} AND "userId" = ${tenantId}
    GROUP BY 1, 2, 3
    ORDER BY 1 ASC
  `;

  const deviceIds = new Set<string>();
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const date = bucketDateToIso(row.date);
    const cost = estimateCost(row.model, {
      inputTokens: bigintToNumber(row.input),
      cachedInputTokens: bigintToNumber(row.cached),
      cacheWriteTokens: bigintToNumber(row.cwrite),
      outputTokens: bigintToNumber(row.output)
    });
    if (cost == null) continue;
    deviceIds.add(row.deviceId);
    const key = `${date}|${row.deviceId}`;
    byKey.set(key, (byKey.get(key) ?? 0) + cost);
  }
  const deviceList = Array.from(deviceIds);
  const devices = deviceList.length ? await prisma.device.findMany({ where: { id: { in: deviceList }, userId: tenantId } }) : [];
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  // Zero-fill missing days so the chart x-axis always reaches today_local,
  // even on days with no events.
  const sortedDates = localDateRange(timezone, days);
  return {
    dates: sortedDates,
    series: deviceList.map((id) => ({
      name: nameById.get(id) ?? id,
      data: sortedDates.map((date) => byKey.get(`${date}|${id}`) ?? 0)
    }))
  };
}

async function getProjectSummaryImpl(tenantId: string, range: RangeOption = "all", filter: ProjectFilter = "all") {
  const where = rangeWhere(range, tenantId);
  const [rows, costRows] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: ["projectId"],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _max: { occurredAt: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 40
    }),
    prisma.usageEvent.groupBy({
      by: ["projectId", "model"],
      where,
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
  const projects = await prisma.project.findMany({ where: { id: { in: rows.map((row) => row.projectId).filter(Boolean) as string[] }, userId: tenantId } });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const out = rows.map((row) => {
    const inputTokens = row._sum.inputTokens ?? 0;
    const outputTokens = row._sum.outputTokens ?? 0;
    const cachedInputTokens = row._sum.cachedInputTokens ?? 0;
    const billableTokens = billableOf(inputTokens, cachedInputTokens, outputTokens);
    const project = row.projectId ? projectById.get(row.projectId) : undefined;
    return {
      projectId: row.projectId,
      name: project?.name ?? "Unknown Project",
      workspacePath: project?.workspacePath ?? null,
      repoKey: project?.repoKey ?? null,
      repoRemote: project?.repoRemote ?? null,
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
  const filtered = filter === "gitOnly" ? out.filter((row) => row.repoKey && row.repoKey.trim() !== "") : out;
  return filtered.slice(0, 20);
}

// Per-project (and its sub-tables) need their own model breakdown too — used
// by /projects/[id] to fill Sources / Models tables with cost columns.
export async function getProjectDetail(tenantId: string, projectId: string) {
  const projectWhere = { userId: tenantId, projectId };
  const [totals, events, bySource, byModel, sourceCostRows, modelCostRows, projectCost] = await Promise.all([
    prisma.usageEvent.aggregate({
      where: projectWhere,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true }
    }),
    prisma.usageEvent.findMany({ where: projectWhere, take: 100, orderBy: { occurredAt: "desc" } }),
    prisma.usageEvent.groupBy({
      by: ["source"],
      where: projectWhere,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where: projectWhere,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
      _count: true
    }),
    prisma.usageEvent.groupBy({
      by: ["source", "model"],
      where: projectWhere,
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where: projectWhere,
      _sum: { inputTokens: true, cachedInputTokens: true, cacheWriteTokens: true, outputTokens: true }
    }),
    costForWhere(projectWhere)
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

function daysForRange(range: RangeOption): number {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  return 180;
}

// yyyy-mm-dd for the calendar day at `now` in `timezone`. Charts must end on
// the user's local "today" even when no event has been recorded yet today, so
// the daily aggregators reach for this to bound the rendered range.
export function localDateRange(timezone: string, days: number, now: Date = new Date()): string[] {
  if (days <= 0) return [];
  // en-CA's narrow formatter outputs zero-padded yyyy-mm-dd, matching the
  // shape produced by bucketDateToIso on the SQL side.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  // Parse as a UTC instant and step by whole UTC days. We never look at the
  // hour, so DST transitions in `timezone` cannot perturb the date arithmetic.
  const end = new Date(`${today}T00:00:00Z`);
  const out = new Array<string>(days);
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    out[i] = d.toISOString().slice(0, 10);
  }
  return out;
}

async function getDailySummaryImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
  const days = daysForRange(range);
  const since = new Date(Date.now() - days * DAY_MS);

  const rows = await prisma.$queryRaw<DailySummaryRow[]>`
    SELECT
      date_trunc('day', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS date,
      SUM("totalTokens")::bigint AS "totalTokens",
      SUM("inputTokens")::bigint AS "inputTokens",
      SUM("outputTokens")::bigint AS "outputTokens",
      SUM("cachedInputTokens")::bigint AS "cachedInputTokens",
      SUM(GREATEST("inputTokens" - "cachedInputTokens", 0) + "outputTokens")::bigint AS "billableTokens"
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${since} AND "userId" = ${tenantId}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const byDate = new Map<string, DailySummaryRow>();
  for (const row of rows) byDate.set(bucketDateToIso(row.date), row);
  // Zero-fill missing days so the chart x-axis always reaches today_local,
  // even on days with no events.
  return localDateRange(timezone, days).map((date) => {
    const row = byDate.get(date);
    return {
      date,
      totalTokens: row ? bigintToNumber(row.totalTokens) : 0,
      inputTokens: row ? bigintToNumber(row.inputTokens) : 0,
      outputTokens: row ? bigintToNumber(row.outputTokens) : 0,
      cachedInputTokens: row ? bigintToNumber(row.cachedInputTokens) : 0,
      billableTokens: row ? bigintToNumber(row.billableTokens) : 0
    };
  });
}

type DailyCostByModelRow = {
  date: Date | string;
  model: string | null;
  input: bigint | number | null;
  cached: bigint | number | null;
  cwrite: bigint | number | null;
  output: bigint | number | null;
};

// Cost per day. We have to GROUP BY (day, model) and then apply per-model
// pricing in JS since costs vary by model. Daily roll-up is a small result
// set so the JS step is cheap.
async function getDailyCostImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
  const days = daysForRange(range);
  const since = new Date(Date.now() - days * DAY_MS);

  const rows = await prisma.$queryRaw<DailyCostByModelRow[]>`
    SELECT
      date_trunc('day', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS date,
      model,
      SUM("inputTokens")::bigint AS input,
      SUM("cachedInputTokens")::bigint AS cached,
      SUM("cacheWriteTokens")::bigint AS cwrite,
      SUM("outputTokens")::bigint AS output
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${since} AND "userId" = ${tenantId}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  const costByDate = new Map<string, number>();
  for (const row of rows) {
    const date = bucketDateToIso(row.date);
    const cost = estimateCost(row.model, {
      inputTokens: bigintToNumber(row.input),
      cachedInputTokens: bigintToNumber(row.cached),
      cacheWriteTokens: bigintToNumber(row.cwrite),
      outputTokens: bigintToNumber(row.output)
    });
    if (cost == null) continue;
    costByDate.set(date, (costByDate.get(date) ?? 0) + cost);
  }
  return localDateRange(timezone, days).map((date) => ({
    date,
    cost: costByDate.get(date) ?? 0
  }));
}

type DailyBySourceRow = {
  date: Date | string;
  source: string;
  input: bigint | number | null;
};

// Per-source input tokens per day — used by the stacked area chart. We use
// inputTokens (total input, including cache) rather than billable so the
// stacked area conveys "how much each source consumed" intuitively.
async function getDailyBySourceImpl(
  tenantId: string,
  range: RangeOption = "all",
  timezone: string = "Asia/Shanghai",
) {
  const days = daysForRange(range);
  const since = new Date(Date.now() - days * DAY_MS);

  const rows = await prisma.$queryRaw<DailyBySourceRow[]>`
    SELECT
      date_trunc('day', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS date,
      source,
      SUM("inputTokens")::bigint AS input
    FROM "UsageEvent"
    WHERE "occurredAt" >= ${since} AND "userId" = ${tenantId}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  const sources = new Set<string>();
  const byDateSource = new Map<string, number>();
  for (const row of rows) {
    const date = bucketDateToIso(row.date);
    sources.add(row.source);
    byDateSource.set(`${date}|${row.source}`, bigintToNumber(row.input));
  }
  const sortedDates = localDateRange(timezone, days);
  const sortedSources = Array.from(sources).sort();
  return {
    dates: sortedDates,
    sources: sortedSources,
    series: sortedSources.map((source) => ({
      name: source,
      data: sortedDates.map((date) => byDateSource.get(`${date}|${source}`) ?? 0)
    }))
  };
}

async function getBreakdownImpl(tenantId: string, field: "source" | "model", range: RangeOption = "all") {
  const where = rangeWhere(range, tenantId);
  const [rows, costRows] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: [field],
      where,
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, cacheWriteTokens: true },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    }),
    prisma.usageEvent.groupBy({
      by: [field, "model"],
      where,
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

// ---- Cached public API ---------------------------------------------------
// Wrappers attach Next's unstable_cache with a 30s revalidate. Arguments are
// part of the cache key automatically, so (range, filter, field) tuples each
// get their own slot. Detail functions (getProjectDetail, getDeviceDetail)
// are intentionally NOT cached — they return Prisma Date objects that the
// JSON cache layer would coerce to strings and break their consumers.

// Opt-in cache-miss logging. Set CACHE_DEBUG=1 in the server env to see every
// unstable_cache miss with its underlying query time — useful for spotting
// when a regression starts bypassing the cache. Off by default.
const CACHE_DEBUG = process.env.CACHE_DEBUG === "1";
function instrument<T extends (...args: never[]) => Promise<unknown>>(name: string, fn: T): T {
  if (!CACHE_DEBUG) return fn;
  return (async (...args: never[]) => {
    const start = Date.now();
    const result = await fn(...args);
    console.log(`[cache-miss] ${name}(${JSON.stringify(args)}) ${Date.now() - start}ms`);
    return result;
  }) as T;
}

export const getSummary = unstable_cache(instrument("getSummary", getSummaryImpl), ["getSummary"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getDeviceSummary = unstable_cache(instrument("getDeviceSummary", getDeviceSummaryImpl), ["getDeviceSummary"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getProjectSummary = unstable_cache(instrument("getProjectSummary", getProjectSummaryImpl), ["getProjectSummary"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getDailySummary = unstable_cache(instrument("getDailySummary", getDailySummaryImpl), ["getDailySummary"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getDailyCost = unstable_cache(instrument("getDailyCost", getDailyCostImpl), ["getDailyCost"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getDailyBySource = unstable_cache(instrument("getDailyBySource", getDailyBySourceImpl), ["getDailyBySource"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getDailyByDevice = unstable_cache(instrument("getDailyByDevice", getDailyByDeviceImpl), ["getDailyByDevice"], { revalidate: CACHE_REVALIDATE_SECONDS });
export const getBreakdown = unstable_cache(instrument("getBreakdown", getBreakdownImpl), ["getBreakdown"], { revalidate: CACHE_REVALIDATE_SECONDS });
