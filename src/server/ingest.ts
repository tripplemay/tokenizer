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

async function ensureDevice(device: DeviceInput, lastSyncAt?: Date) {
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
  let inserted = 0;
  let duplicates = 0;
  const now = new Date();
  const device = await ensureDevice(deviceInput, now);
  await prisma.deviceToken.update({ where: { id: deviceTokenId }, data: { lastUsedAt: now } });

  for (const event of events) {
    const project = await ensureProject(event);
    const totalTokens = computeTotalTokens(event);

    try {
      await prisma.usageEvent.create({
        data: {
          deviceId: device.id,
          source: event.source,
          sourceEventId: event.sourceEventId,
          projectId: project.id,
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
          totalTokens,
          costUsd: event.costUsd == null ? null : new Prisma.Decimal(event.costUsd),
          occurredAt: new Date(event.occurredAt),
          rawJson: event.rawJson === undefined ? Prisma.JsonNull : (event.rawJson as Prisma.InputJsonValue)
        }
      });
      inserted += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        duplicates += 1;
        continue;
      }
      throw error;
    }
  }

  return { inserted, duplicates, received: events.length, deviceId: device.id };
}
