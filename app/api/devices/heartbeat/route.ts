import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import { updateUserTimezoneIfValid } from "@/server/timezone";
import { sanitizeDeviceForIngest } from "@/shared/input-sanitization";
import { DeviceInput } from "@/shared/usage";
import { harnessDiagnosticsFromSnapshot, parseHarnessSyncSnapshot } from "@/shared/harness-health";
import { compareAgentReleaseVersion, normalizeAgentReleaseVersion } from "@/shared/agent-release-version";
import { MAX_AGENT_FEATURE_VERSION } from "@/shared/agent-feature-version";
import { retrySerializableTransaction } from "@/server/serializable-transaction";

export const dynamic = "force-dynamic";

type ReporterVersions = {
  agentReleaseVersion?: string | null;
  agentFeatureVersion?: number | null;
};

type StoredReporterVersions = {
  agentReleaseVersion: string | null;
  agentFeatureVersion: number | null;
};

class DeviceTokenRevokedError extends Error {}

function knownFeatureVersion(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AGENT_FEATURE_VERSION
    ? value
    : null;
}

// Once a device has accepted a reporter with a version signal, a reporter
// must identify itself at least as new in every known dimension. This keeps a
// lingering old daemon from replacing the diagnostics belonging to a newer
// process that shares its device identity.
function isReporterAccepted(current: StoredReporterVersions, incoming: ReporterVersions): boolean {
  const currentRelease = normalizeAgentReleaseVersion(current.agentReleaseVersion);
  if (currentRelease) {
    if (incoming.agentReleaseVersion === undefined || incoming.agentReleaseVersion === null) return false;
    const comparison = compareAgentReleaseVersion(incoming.agentReleaseVersion, currentRelease);
    if (comparison === null || comparison < 0) return false;
  }

  const currentFeature = knownFeatureVersion(current.agentFeatureVersion);
  if (currentFeature !== null) {
    if (incoming.agentFeatureVersion === undefined || incoming.agentFeatureVersion === null) return false;
    if (incoming.agentFeatureVersion < currentFeature) return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json().catch(() => null)) as { device?: DeviceInput; timezone?: string } | null;
  if (!body?.device?.id || !body.device.name) return Response.json({ error: "device is required" }, { status: 400 });
  const device = sanitizeDeviceForIngest(body.device);
  if (device.id !== token.deviceId) return forbidden("device token does not match device");

  const now = new Date();
  // Diagnostics are optional for protocol compatibility. A reporter must
  // identify a concrete release or feature capability before its diagnostics
  // can become authoritative; legacy heartbeats remain liveness-only.
  const rawDiag = body.device.diagnostics;
  if (rawDiag !== undefined && (typeof rawDiag !== "object" || rawDiag === null || Array.isArray(rawDiag))) {
    return Response.json({ error: "invalid diagnostics", code: "invalid_diagnostics" }, { status: 400 });
  }
  const diag = (rawDiag ?? {}) as NonNullable<DeviceInput["diagnostics"]> & Record<string, unknown>;
  const harness = "harness" in diag ? parseHarnessSyncSnapshot(diag.harness) : null;
  if ("harness" in diag && !harness) {
    return Response.json(
      { error: "invalid harness diagnostics", code: "invalid_harness_diagnostics" },
      { status: 400 }
    );
  }
  const releaseVersion = "agentReleaseVersion" in diag
    ? normalizeAgentReleaseVersion(diag.agentReleaseVersion)
    : undefined;
  if ("agentReleaseVersion" in diag && diag.agentReleaseVersion !== null && !releaseVersion) {
    return Response.json(
      { error: "invalid agent release version", code: "invalid_agent_release_version" },
      { status: 400 }
    );
  }
  const featureVersion = "agentFeatureVersion" in diag ? diag.agentFeatureVersion : undefined;
  if (
    featureVersion !== undefined &&
    featureVersion !== null &&
    (
      typeof featureVersion !== "number" ||
      !Number.isSafeInteger(featureVersion) ||
      featureVersion < 0 ||
      featureVersion > MAX_AGENT_FEATURE_VERSION
    )
  ) {
    return Response.json(
      { error: "invalid agent feature version", code: "invalid_agent_feature_version" },
      { status: 400 }
    );
  }
  const hasReporterIdentity =
    (releaseVersion !== undefined && releaseVersion !== null) ||
    (featureVersion !== undefined && featureVersion !== null);
  let heartbeat: {
    accepted: boolean;
    agentReleaseVersion: string | null;
    agentFeatureVersion: number | null;
  };
  try {
    heartbeat = await retrySerializableTransaction(() =>
      prisma.$transaction(
      async (tx) => {
        // Lock the Device before the DeviceToken, matching Harness reports,
        // relays, and enrollment. That ordering serializes an old daemon's
        // snapshot behind a newer accepted reporter instead of allowing it
        // to read before the version guard is advanced.
        const lockedDevice = await tx.device.updateMany({
          where: { id: device.id, userId: token.userId },
          data: { lastSeenAt: now }
        });
        if (lockedDevice.count !== 1) throw new DeviceTokenRevokedError();

        // Authentication happened before this transaction. A conditional
        // update rechecks that force-enrollment has not revoked this token
        // and advances lastUsedAt only for the still-active credential.
        const activeToken = await tx.deviceToken.updateMany({
          where: { id: token.id, deviceId: token.deviceId, userId: token.userId, revokedAt: null },
          data: { lastUsedAt: now }
        });
        if (activeToken.count !== 1) throw new DeviceTokenRevokedError();

        const current = await tx.device.findUnique({
          where: { id: body.device.id },
          select: { agentReleaseVersion: true, agentFeatureVersion: true }
        });
        if (!current) throw new DeviceTokenRevokedError();

        const accepted = hasReporterIdentity && isReporterAccepted(current, {
          agentReleaseVersion: "agentReleaseVersion" in diag ? releaseVersion ?? null : undefined,
          agentFeatureVersion: "agentFeatureVersion" in diag ? featureVersion ?? null : undefined
        });
        const data: Prisma.DeviceUpdateInput = {
          name: device.name,
          hostname: device.hostname ?? null,
          platform: device.platform ?? null,
          metadata: device.metadata === undefined ? Prisma.JsonNull : (device.metadata as Prisma.InputJsonValue),
          lastSeenAt: now
        };

        if (accepted) {
          if ("agentVersion" in diag) data.agentVersion = diag.agentVersion ?? null;
          if ("agentReleaseVersion" in diag) data.agentReleaseVersion = releaseVersion ?? null;
          if ("agentFeatureVersion" in diag) data.agentFeatureVersion = featureVersion ?? null;
          if ("queueDepth" in diag) data.queueDepth = typeof diag.queueDepth === "number" ? diag.queueDepth : null;
          if ("lastError" in diag) {
            data.lastError = diag.lastError ?? null;
            data.lastErrorAt = diag.lastError ? now : null;
          }
          if ("lastSyncStatus" in diag) data.lastSyncStatus = diag.lastSyncStatus ?? null;
          if (harness) {
            data.lastHarnessSyncAt = new Date(harness.attemptedAt);
            data.harnessSyncStatus = harness.status;
            data.harnessDiagnostics = harnessDiagnosticsFromSnapshot(harness) as Prisma.InputJsonValue;
          }
          data.reporterTokenPrefix = token.prefix;
          data.reportedAt = now;
        }

        await tx.device.update({ where: { id: device.id }, data });

        return {
          accepted,
          agentReleaseVersion:
            accepted && "agentReleaseVersion" in diag ? releaseVersion ?? null : current.agentReleaseVersion,
          agentFeatureVersion:
            accepted && "agentFeatureVersion" in diag ? featureVersion ?? null : current.agentFeatureVersion
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  } catch (error) {
    if (error instanceof DeviceTokenRevokedError) return unauthorized();
    throw error;
  }

  await updateUserTimezoneIfValid(token.userId, body.timezone);

  return Response.json({
    ok: true,
    accepted: heartbeat.accepted,
    deviceId: device.id,
    lastSeenAt: now.toISOString(),
    agentReleaseVersion: heartbeat.agentReleaseVersion,
    agentFeatureVersion: heartbeat.agentFeatureVersion
  });
}
