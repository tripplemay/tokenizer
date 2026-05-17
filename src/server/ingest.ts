import { Prisma } from "@prisma/client";
import { computeTotalTokens, DeviceInput, normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { prisma } from "./db";

// Postgres' jsonb type rejects NUL bytes (U+0000). Old per-event create
// quietly dropped bad rows; createMany fails the whole batch on any single
// bad row, so we sanitize defensively here before we ever hit the wire.
const NUL = String.fromCharCode(0);
function stripNullBytesFromString(value: string): string {
  return value.indexOf(NUL) === -1 ? value : value.split(NUL).join("");
}
function stripNullBytesDeep(value: unknown): unknown {
  if (typeof value === "string") return stripNullBytesFromString(value);
  if (Array.isArray(value)) return value.map(stripNullBytesDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripNullBytesDeep(v);
    return out;
  }
  return value;
}
function sanitizeNullableString<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  return stripNullBytesFromString(value) as T;
}

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

  if (repoKey) {
    // When the event has a git remote, the project's display name is fully
    // determined by the repoKey's last segment. Local folder names ("joyce"
    // on a Mac, "kolmatrix" on a WSL host) are intentionally ignored so the
    // dashboard label doesn't flap depending on which device synced last.
    const canonicalName = projectNameFromRepoKey(repoKey) ?? event.projectName?.trim() ?? projectNameFromPath(workspacePath);
    return prisma.project.upsert({
      where: { repoKey },
      update: { name: canonicalName, repoRemote: event.gitRemote ?? undefined },
      create: { name: canonicalName, repoKey, repoRemote: event.gitRemote ?? null, workspacePath }
    });
  }

  // Below: best-effort dedup for non-git projects. workspacePath is per-machine
  // so two devices opening the same folder under different paths will create
  // separate Project rows. That's a known limitation — without git remote
  // there's no canonical identity to merge on.
  const fallbackName = event.projectName?.trim() || projectNameFromPath(workspacePath);
  if (workspacePath) {
    return prisma.project.upsert({
      where: { workspacePath },
      update: { name: fallbackName },
      create: { name: fallbackName, workspacePath }
    });
  }

  const existing = await prisma.project.findFirst({ where: { name: fallbackName, workspacePath: null } });
  if (existing) return existing;
  return prisma.project.create({ data: { name: fallbackName } });
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

  // 2) Build the row payload for createMany. Every user-supplied string and
  // the rawJson payload pass through stripNullBytesDeep / sanitizeNullableString —
  // Postgres jsonb / text columns refuse U+0000, and a single bad row would
  // otherwise fail the entire batch (createMany is not row-isolated the way
  // the old per-event create loop was).
  const rows = events.map((event) => ({
    deviceId: device.id,
    source: event.source,
    sourceEventId: stripNullBytesFromString(event.sourceEventId),
    projectId: projectIdByKey.get(projectKey(event)) ?? null,
    sessionId: sanitizeNullableString(event.sessionId ?? null),
    workspacePath: sanitizeNullableString(event.workspacePath ?? null),
    localWorkspacePath: sanitizeNullableString(event.localWorkspacePath ?? event.workspacePath ?? null),
    repoKey: sanitizeNullableString(event.repoKey ?? null),
    gitRemote: sanitizeNullableString(event.gitRemote ?? null),
    gitBranch: sanitizeNullableString(event.gitBranch ?? null),
    gitCommit: sanitizeNullableString(event.gitCommit ?? null),
    model: sanitizeNullableString(event.model ?? null),
    inputTokens: normalizeTokenCount(event.inputTokens),
    outputTokens: normalizeTokenCount(event.outputTokens),
    cachedInputTokens: normalizeTokenCount(event.cachedInputTokens),
    cacheWriteTokens: normalizeTokenCount(event.cacheWriteTokens),
    reasoningOutputTokens: normalizeTokenCount(event.reasoningOutputTokens),
    totalTokens: computeTotalTokens(event),
    costUsd: event.costUsd == null ? null : new Prisma.Decimal(event.costUsd),
    occurredAt: new Date(event.occurredAt),
    rawJson:
      event.rawJson === undefined
        ? Prisma.JsonNull
        : (stripNullBytesDeep(event.rawJson) as Prisma.InputJsonValue)
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
