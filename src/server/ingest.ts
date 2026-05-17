import { Prisma } from "@prisma/client";
import { computeTotalTokens, DeviceInput, normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { prisma } from "./db";

function projectNameFromPath(workspacePath?: string | null): string {
  if (!workspacePath) return "Unknown Project";
  const clean = workspacePath.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).at(-1) ?? "Unknown Project";
}

function projectNameFromRepoKey(repoKey?: string | null): string | null {
  if (!repoKey) return null;
  return repoKey.split("/").filter(Boolean).at(-1) ?? null;
}

// Canonical key that identifies a Project for batch deduplication. Two events
// that resolve to the same Project must produce the same key so we upsert
// once and reuse the resulting id.
function projectKey(event: UsageEventInput): string {
  const repoKey = event.repoKey?.trim();
  if (repoKey) return `repo:${repoKey}`;
  const workspacePath = event.workspacePath?.trim();
  if (workspacePath) return `path:${workspacePath}`;
  const name = event.projectName?.trim() || "Unknown Project";
  return `name:${name}`;
}

async function ensureProject(event: UsageEventInput) {
  const repoKey = event.repoKey?.trim() || null;
  const workspacePath = event.workspacePath?.trim() || null;
  const name = event.projectName?.trim() || projectNameFromRepoKey(repoKey) || projectNameFromPath(workspacePath);

  if (repoKey) {
    return prisma.project.upsert({
      where: { repoKey },
      update: { name, repoRemote: event.gitRemote ?? undefined },
      create: { name, repoKey, repoRemote: event.gitRemote ?? null, workspacePath }
    });
  }

  if (workspacePath) {
    return prisma.project.upsert({
      where: { workspacePath },
      update: { name },
      create: { name, workspacePath }
    });
  }

  const existing = await prisma.project.findFirst({ where: { name, workspacePath: null } });
  if (existing) return existing;
  return prisma.project.create({ data: { name } });
}

async function ensureDevice(device: DeviceInput, lastSyncAt: Date) {
  return prisma.device.upsert({
    where: { id: device.id },
    update: {
      name: device.name || device.id,
      hostname: device.hostname ?? null,
      platform: device.platform ?? null,
      metadata: device.metadata === undefined ? Prisma.JsonNull : (device.metadata as Prisma.InputJsonValue),
      lastSeenAt: new Date(),
      lastSyncAt
    },
    create: {
      id: device.id,
      name: device.name || device.id,
      hostname: device.hostname ?? null,
      platform: device.platform ?? null,
      metadata: device.metadata === undefined ? Prisma.JsonNull : (device.metadata as Prisma.InputJsonValue),
      lastSeenAt: new Date(),
      lastSyncAt
    }
  });
}

export async function ingestUsageEvents(events: UsageEventInput[], deviceInput: DeviceInput, deviceTokenId: string) {
  const now = new Date();
  const device = await ensureDevice(deviceInput, now);
  await prisma.deviceToken.update({ where: { id: deviceTokenId }, data: { lastUsedAt: now } });

  if (events.length === 0) {
    return { inserted: 0, duplicates: 0, received: 0, deviceId: device.id };
  }

  // 1) Reduce N events to the small set of distinct Projects they reference,
  // upsert each once, then build a lookup map. For a typical 200-event batch
  // this collapses to <15 project upserts instead of 200.
  const projectByKey = new Map<string, UsageEventInput>();
  for (const event of events) {
    const key = projectKey(event);
    if (!projectByKey.has(key)) projectByKey.set(key, event);
  }
  const projectIdByKey = new Map<string, string>();
  for (const [key, sample] of projectByKey) {
    const project = await ensureProject(sample);
    projectIdByKey.set(key, project.id);
  }

  // 2) Build the row payload for createMany.
  const rows = events.map((event) => ({
    deviceId: device.id,
    source: event.source,
    sourceEventId: event.sourceEventId,
    projectId: projectIdByKey.get(projectKey(event)) ?? null,
    sessionId: event.sessionId ?? null,
    workspacePath: event.workspacePath ?? null,
    localWorkspacePath: event.localWorkspacePath ?? event.workspacePath ?? null,
    repoKey: event.repoKey ?? null,
    gitRemote: event.gitRemote ?? null,
    gitBranch: event.gitBranch ?? null,
    gitCommit: event.gitCommit ?? null,
    model: event.model ?? null,
    inputTokens: normalizeTokenCount(event.inputTokens),
    outputTokens: normalizeTokenCount(event.outputTokens),
    cachedInputTokens: normalizeTokenCount(event.cachedInputTokens),
    cacheWriteTokens: normalizeTokenCount(event.cacheWriteTokens),
    reasoningOutputTokens: normalizeTokenCount(event.reasoningOutputTokens),
    totalTokens: computeTotalTokens(event),
    costUsd: event.costUsd == null ? null : new Prisma.Decimal(event.costUsd),
    occurredAt: new Date(event.occurredAt),
    rawJson: event.rawJson === undefined ? Prisma.JsonNull : (event.rawJson as Prisma.InputJsonValue)
  }));

  // 3) Single createMany — Postgres ON CONFLICT DO NOTHING on the unique
  // (deviceId, source, sourceEventId) index handles dedup atomically.
  const result = await prisma.usageEvent.createMany({
    data: rows,
    skipDuplicates: true
  });

  return {
    inserted: result.count,
    duplicates: events.length - result.count,
    received: events.length,
    deviceId: device.id
  };
}
