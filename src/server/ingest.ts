import { Prisma } from "@prisma/client";
import { PARSER_CORRECTION_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { codexCanonicalSourceEventId } from "@/shared/codex-usage";
import { computeTotalTokens, DeviceInput, normalizeTokenCount, UsageEventInput } from "@/shared/usage";
import { pathSegments } from "@/shared/path";
import { sanitizeDeviceForIngest, sanitizeUsageEventForIngest } from "@/shared/input-sanitization";
import { prisma } from "./db";
import { detectAndTrackUnpricedModels } from "./pricing/detect";

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

// Separator handling is shape-driven (see @/shared/path): a Windows client
// posts "C:\Users\me\proj", which a "/"-only split turned into a project
// literally named after the whole path. POSIX paths are unaffected — notably,
// a backslash inside a POSIX path stays part of the directory name.
export function projectNameFromPath(workspacePath?: string | null): string {
  if (!workspacePath) return "Unknown Project";
  return pathSegments(workspacePath).at(-1) ?? "Unknown Project";
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function ensureProject(event: UsageEventInput, userId: string) {
  const repoKey = event.repoKey?.trim() || null;
  const workspacePath = event.workspacePath?.trim() || null;

  if (repoKey) {
    // When the event has a git remote, the project's display name is fully
    // determined by the repoKey's last segment. Local folder names ("joyce"
    // on a Mac, "kolmatrix" on a WSL host) are intentionally ignored so the
    // dashboard label doesn't flap depending on which device synced last.
    const canonicalName = projectNameFromRepoKey(repoKey) ?? event.projectName?.trim() ?? projectNameFromPath(workspacePath);
    try {
      return await prisma.project.upsert({
        where: { userId_repoKey: { userId, repoKey } },
        update: { name: canonicalName, repoRemote: event.gitRemote ?? undefined },
        create: { userId, name: canonicalName, repoKey, repoRemote: event.gitRemote ?? null, workspacePath }
      });
    } catch (error) {
      // A folder that synced before it had a git remote already owns this
      // workspacePath as a repoKey-less row, so the create above trips the
      // (userId, workspacePath) unique. Adopt that row: stamping its repoKey
      // makes every future sync match on (userId, repoKey) directly.
      if (!isUniqueConstraintError(error) || !workspacePath) throw error;
      const existing = await prisma.project.findUnique({
        where: { userId_workspacePath: { userId, workspacePath } }
      });
      if (!existing) throw error;
      return prisma.project.update({
        where: { id: existing.id },
        data: { name: canonicalName, repoKey, repoRemote: event.gitRemote ?? null }
      });
    }
  }

  // Below: best-effort dedup for non-git projects. workspacePath is per-machine
  // so two devices opening the same folder under different paths will create
  // separate Project rows. That's a known limitation — without git remote
  // there's no canonical identity to merge on.
  const fallbackName = event.projectName?.trim() || projectNameFromPath(workspacePath);
  if (workspacePath) {
    return prisma.project.upsert({
      where: { userId_workspacePath: { userId, workspacePath } },
      update: { name: fallbackName },
      create: { userId, name: fallbackName, workspacePath }
    });
  }

  const existing = await prisma.project.findFirst({ where: { userId, name: fallbackName, workspacePath: null } });
  if (existing) return existing;
  return prisma.project.create({ data: { userId, name: fallbackName } });
}

async function ensureDevice(device: DeviceInput, lastSyncAt: Date, userId: string) {
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
      userId,
      name: device.name || device.id,
      hostname: device.hostname ?? null,
      platform: device.platform ?? null,
      metadata: device.metadata === undefined ? Prisma.JsonNull : (device.metadata as Prisma.InputJsonValue),
      lastSeenAt: new Date(),
      lastSyncAt
    }
  });
}

export async function ingestUsageEvents(events: UsageEventInput[], deviceInput: DeviceInput, deviceTokenId: string, userId: string) {
  const safeDevice = sanitizeDeviceForIngest(deviceInput);
  const safeEvents = events.map(sanitizeUsageEventForIngest);
  const now = new Date();
  const device = await ensureDevice(safeDevice, now, userId);
  await prisma.deviceToken.update({ where: { id: deviceTokenId }, data: { lastUsedAt: now } });

  if (safeEvents.length === 0) {
    return { inserted: 0, duplicates: 0, received: 0, deviceId: device.id };
  }

  // 1) Reduce N events to the small set of distinct Projects they reference,
  // upsert each once, then build a lookup map.
  const projectByKey = new Map<string, UsageEventInput>();
  for (const event of safeEvents) {
    const key = projectKey(event);
    if (!projectByKey.has(key)) projectByKey.set(key, event);
  }
  const projectIdByKey = new Map<string, string>();
  for (const [key, sample] of projectByKey) {
    try {
      const project = await ensureProject(sample, userId);
      projectIdByKey.set(key, project.id);
    } catch (error) {
      // One broken project must not block the whole batch: keep its events
      // (projectId stays null) so the client's queue still drains.
      console.error(`ensureProject failed for ${key} (user ${userId}); ingesting events without project link`, error);
    }
  }

  // 2) Build the row payload for createMany. Every user-supplied string and
  // the rawJson payload pass through stripNullBytesDeep / sanitizeNullableString —
  // Postgres jsonb / text columns refuse U+0000, and a single bad row would
  // otherwise fail the entire batch (createMany is not row-isolated the way
  // the old per-event create loop was).
  const rows = safeEvents.map((event) => toRow(event, userId, device.id, projectIdByKey.get(projectKey(event)) ?? null));

  // 3) Single createMany — Postgres ON CONFLICT DO NOTHING on the unique
  // (deviceId, source, sourceEventId) index handles dedup atomically.
  const result = await prisma.usageEvent.createMany({
    data: rows,
    skipDuplicates: true
  });

  // 4) A conflict is usually an identical re-upload (a grown file gets fully
  // re-parsed), but a message that completed after its first partial parse
  // legitimately revises the stored row: the final streamed row carries the
  // real bill and, on a mid-request model fallback, the corrected model
  // attribution. Update those rows in place instead of dropping the new data.
  // Gated on the agent's feature version — older agents still upload
  // first-row placeholder snapshots that must not regress corrected rows.
  const agentCanCorrect =
    (safeDevice.diagnostics?.agentFeatureVersion ?? 0) >= PARSER_CORRECTION_FEATURE_VERSION;
  const updated =
    agentCanCorrect && result.count < rows.length ? await correctStaleDuplicates(rows, device.id, userId) : 0;

  // 5) Auto-pricing detection. Any model the seed doesn't price and that isn't
  // already tracked gets a ModelPrice row (detected, or auto $0 for -free). This
  // is best-effort and fully isolated: a detection failure must never fail the
  // client's upload, which has already been committed above.
  let newModelKeys: string[] = [];
  try {
    newModelKeys = await detectAndTrackUnpricedModels(safeEvents.map((event) => event.model));
  } catch (error) {
    console.error(`model-price detection failed (user ${userId}); ingest unaffected`, error);
  }

  return {
    inserted: result.count,
    updated,
    duplicates: safeEvents.length - result.count - updated,
    received: safeEvents.length,
    deviceId: device.id,
    // Keys needing a price lookup. The batch route triggers an out-of-band
    // lookup for these after responding (see app/api/usage/events/batch).
    newModelKeys
  };
}

type IngestRow = ReturnType<typeof toRow>;

function toRow(event: UsageEventInput, userId: string, deviceId: string, projectId: string | null) {
  const legacySourceEventId = stripNullBytesFromString(event.sourceEventId);
  const sourceEventId =
    event.source === "codex"
      ? stripNullBytesFromString(codexCanonicalSourceEventId(event.sessionId, event.rawJson, legacySourceEventId))
      : legacySourceEventId;
  return {
    userId,
    deviceId,
    source: event.source,
    sourceEventId,
    projectId,
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
    cacheEphemeral5mInputTokens: normalizeTokenCount(event.cacheEphemeral5mInputTokens),
    cacheEphemeral1hInputTokens: normalizeTokenCount(event.cacheEphemeral1hInputTokens),
    webSearchRequests: normalizeTokenCount(event.webSearchRequests),
    webFetchRequests: normalizeTokenCount(event.webFetchRequests),
    serviceTier: sanitizeNullableString(event.serviceTier ?? null),
    fallbackFromModel: sanitizeNullableString(event.fallbackFromModel ?? null),
    fallbackToModel: sanitizeNullableString(event.fallbackToModel ?? null),
    totalTokens: computeTotalTokens(event),
    costUsd: event.costUsd == null ? null : new Prisma.Decimal(event.costUsd),
    occurredAt: new Date(event.occurredAt),
    rawJson:
      event.rawJson === undefined
        ? Prisma.JsonNull
        : (stripNullBytesDeep(event.rawJson) as Prisma.InputJsonValue)
  };
}

// Fields a re-parse can legitimately revise. Identity fields (occurredAt is
// pinned to the first streamed row) and costUsd (display-time computed) are
// deliberately excluded so identical re-uploads stay write-free.
const COMPARABLE_FIELDS = [
  "model",
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "reasoningOutputTokens",
  "cacheEphemeral5mInputTokens",
  "cacheEphemeral1hInputTokens",
  "webSearchRequests",
  "webFetchRequests",
  "serviceTier",
  "totalTokens",
  "fallbackFromModel",
  "fallbackToModel"
] as const;

async function correctStaleDuplicates(rows: IngestRow[], deviceId: string, userId: string): Promise<number> {
  const bySource = new Map<string, Map<string, IngestRow>>();
  for (const row of rows) {
    const forSource = bySource.get(row.source) ?? new Map<string, IngestRow>();
    forSource.set(row.sourceEventId, row);
    bySource.set(row.source, forSource);
  }

  const updates: ReturnType<typeof prisma.usageEvent.update>[] = [];
  for (const [source, rowsByEventId] of bySource) {
    // userId is redundant with the deviceId scope (Device.id is globally
    // unique and the route already pinned it to the token) but this function
    // mutates billing rows, so scope defensively anyway.
    const existing = await prisma.usageEvent.findMany({
      where: { userId, deviceId, source, sourceEventId: { in: [...rowsByEventId.keys()] } },
      select: {
        id: true,
        sourceEventId: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
        cacheWriteTokens: true,
        reasoningOutputTokens: true,
        cacheEphemeral5mInputTokens: true,
        cacheEphemeral1hInputTokens: true,
        webSearchRequests: true,
        webFetchRequests: true,
        serviceTier: true,
        totalTokens: true,
        fallbackFromModel: true,
        fallbackToModel: true
      }
    });
    for (const current of existing) {
      const incoming = rowsByEventId.get(current.sourceEventId);
      if (!incoming) continue;
      const changes = COMPARABLE_FIELDS.filter(
        (field) => (incoming[field] ?? null) !== ((current as Record<string, unknown>)[field] ?? null)
      );
      if (changes.length === 0) continue;
      // Corrections are the only path that mutates a billing row after
      // insert — leave an audit trail of exactly what moved.
      console.warn(
        `usage-event correction (user ${userId}, device ${deviceId}): ${source}/${current.sourceEventId} ` +
          changes
            .map((field) => `${field}: ${(current as Record<string, unknown>)[field] ?? null} -> ${incoming[field] ?? null}`)
            .join(", ")
      );
      updates.push(
        prisma.usageEvent.update({
          where: { id: current.id },
          data: {
            model: incoming.model,
            inputTokens: incoming.inputTokens,
            outputTokens: incoming.outputTokens,
            cachedInputTokens: incoming.cachedInputTokens,
            cacheWriteTokens: incoming.cacheWriteTokens,
            reasoningOutputTokens: incoming.reasoningOutputTokens,
            cacheEphemeral5mInputTokens: incoming.cacheEphemeral5mInputTokens,
            cacheEphemeral1hInputTokens: incoming.cacheEphemeral1hInputTokens,
            webSearchRequests: incoming.webSearchRequests,
            webFetchRequests: incoming.webFetchRequests,
            serviceTier: incoming.serviceTier,
            totalTokens: incoming.totalTokens,
            fallbackFromModel: incoming.fallbackFromModel,
            fallbackToModel: incoming.fallbackToModel,
            rawJson: incoming.rawJson
          }
        })
      );
    }
  }
  if (updates.length === 0) return 0;
  await prisma.$transaction(updates);
  return updates.length;
}
