import { prisma } from "./db";

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
    prisma.usageEvent.aggregate({ where: { project: { name: "Unknown Project" } }, _sum: { totalTokens: true } }),
    prisma.usageEvent.aggregate({ where: { model: null }, _sum: { totalTokens: true } })
  ]);

  return {
    totalTokens: total._sum.totalTokens ?? 0,
    inputTokens: total._sum.inputTokens ?? 0,
    outputTokens: total._sum.outputTokens ?? 0,
    cachedInputTokens: total._sum.cachedInputTokens ?? 0,
    reasoningOutputTokens: total._sum.reasoningOutputTokens ?? 0,
    todayTokens: todayAgg._sum.totalTokens ?? 0,
    weekTokens: weekAgg._sum.totalTokens ?? 0,
    monthTokens: monthAgg._sum.totalTokens ?? 0,
    eventCount,
    projectCount,
    deviceCount,
    lastEventAt: lastEvent?.occurredAt?.toISOString() ?? null,
    unknownProjectTokens: unknownProject._sum.totalTokens ?? 0,
    unknownModelTokens: unknownModel._sum.totalTokens ?? 0
  };
}

export async function getDeviceSummary() {
  const rows = await prisma.usageEvent.groupBy({
    by: ["deviceId"],
    _sum: { totalTokens: true },
    _count: true,
    _max: { occurredAt: true },
    orderBy: { _sum: { totalTokens: "desc" } }
  });
  const devices = await prisma.device.findMany({ where: { id: { in: rows.map((row) => row.deviceId) } } });
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  return rows.map((row) => {
    const device = deviceById.get(row.deviceId);
    return {
      deviceId: row.deviceId,
      name: device?.name ?? row.deviceId,
      hostname: device?.hostname ?? null,
      platform: device?.platform ?? null,
      lastSeenAt: device?.lastSeenAt?.toISOString() ?? null,
      lastEventAt: row._max.occurredAt?.toISOString() ?? null,
      totalTokens: row._sum.totalTokens ?? 0,
      events: row._count
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
  return rows.map((row) => ({
    projectId: row.projectId,
    name: row.projectId ? projectById.get(row.projectId)?.name ?? "Unknown Project" : "Unknown Project",
    workspacePath: row.projectId ? projectById.get(row.projectId)?.workspacePath ?? null : null,
    totalTokens: row._sum.totalTokens ?? 0,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
    events: row._count,
    avgTokensPerEvent: row._count > 0 ? Math.round((row._sum.totalTokens ?? 0) / row._count) : 0,
    lastActiveAt: row._max.occurredAt?.toISOString() ?? null
  }));
}

export async function getDailySummary(days = 180) {
  const since = new Date(Date.now() - days * DAY_MS);
  const events = await prisma.usageEvent.findMany({
    where: { occurredAt: { gte: since } },
    select: { occurredAt: true, totalTokens: true, inputTokens: true, outputTokens: true, source: true, model: true },
    orderBy: { occurredAt: "asc" }
  });

  const byDay = new Map<string, { date: string; totalTokens: number; inputTokens: number; outputTokens: number }>();
  for (const event of events) {
    const date = event.occurredAt.toISOString().slice(0, 10);
    const row = byDay.get(date) ?? { date, totalTokens: 0, inputTokens: 0, outputTokens: 0 };
    row.totalTokens += event.totalTokens;
    row.inputTokens += event.inputTokens;
    row.outputTokens += event.outputTokens;
    byDay.set(date, row);
  }
  return Array.from(byDay.values());
}

export async function getBreakdown(field: "source" | "model") {
  const rows = await prisma.usageEvent.groupBy({
    by: [field],
    _sum: { totalTokens: true },
    _count: true,
    orderBy: { _sum: { totalTokens: "desc" } },
    take: 20
  });
  return rows.map((row) => ({
    name: String(row[field] ?? "unknown"),
    totalTokens: row._sum.totalTokens ?? 0,
    events: row._count,
    avgTokensPerEvent: row._count > 0 ? Math.round((row._sum.totalTokens ?? 0) / row._count) : 0
  }));
}
