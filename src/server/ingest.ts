import { Prisma } from "@prisma/client";
import { computeTotalTokens, DeviceInput, normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { prisma } from "./db";

const LEGACY_DEVICE_ID = "dev_local_legacy";

function projectNameFromPath(workspacePath?: string | null): string {
  if (!workspacePath) return "Unknown Project";
  const clean = workspacePath.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).at(-1) ?? "Unknown Project";
}

async function ensureProject(event: UsageEventInput) {
  const workspacePath = event.workspacePath?.trim() || null;
  const name = event.projectName?.trim() || projectNameFromPath(workspacePath);

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

async function ensureDevice(device?: DeviceInput) {
  const normalized = device?.id
    ? device
    : {
        id: LEGACY_DEVICE_ID,
        name: "Local Device",
        metadata: { legacy: true }
      };

  return prisma.device.upsert({
    where: { id: normalized.id },
    update: {
      name: normalized.name || normalized.id,
      hostname: normalized.hostname ?? null,
      platform: normalized.platform ?? null,
      metadata: normalized.metadata === undefined ? Prisma.JsonNull : (normalized.metadata as Prisma.InputJsonValue),
      lastSeenAt: new Date()
    },
    create: {
      id: normalized.id,
      name: normalized.name || normalized.id,
      hostname: normalized.hostname ?? null,
      platform: normalized.platform ?? null,
      metadata: normalized.metadata === undefined ? Prisma.JsonNull : (normalized.metadata as Prisma.InputJsonValue),
      lastSeenAt: new Date()
    }
  });
}

export async function ingestUsageEvents(events: UsageEventInput[], deviceInput?: DeviceInput) {
  let inserted = 0;
  let duplicates = 0;
  const device = await ensureDevice(deviceInput);

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
          model: event.model ?? null,
          inputTokens: normalizeTokenCount(event.inputTokens),
          outputTokens: normalizeTokenCount(event.outputTokens),
          cachedInputTokens: normalizeTokenCount(event.cachedInputTokens),
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
