import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { retrySerializableTransaction } from "@/server/serializable-transaction";
import {
  MAX_AGENT_FEATURE_VERSION,
  MIN_HARNESS_REPORTER_IDENTITY_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";
import {
  HARNESS_RELAY_AGENT_FEATURE_VERSION_HEADER,
  HARNESS_RELAY_AGENT_RELEASE_VERSION_HEADER
} from "@/shared/harness-relay-identity";
import { compareAgentReleaseVersion, normalizeAgentReleaseVersion } from "@/shared/agent-release-version";
import { HarnessApiInputError } from "./harness-mode-intent-api";

const FEATURE_VERSION_PATTERN = /^(?:0|[1-9]\d{0,6})$/;

type RelayDeviceToken = {
  id: string;
  userId: string;
  deviceId: string;
};

type StoredAgentIdentity = {
  agentReleaseVersion: string | null;
  agentFeatureVersion: number | null;
};

export type HarnessRelayAgentIdentity = {
  releaseVersion: string;
  featureVersion: number;
};

export type HarnessRelayTransaction = {
  tx: Prisma.TransactionClient;
  now: Date;
};

function invalidIdentity(message = "agent relay identity is invalid"): never {
  throw new HarnessApiInputError("invalid_agent_relay_identity", message);
}

/**
 * Relay GETs cannot carry a JSON body, so all device-driven Harness relays
 * identify their running Agent with this pair of headers. The pair is atomic:
 * a partial identity cannot become an accidental compatibility fallback.
 */
export function parseHarnessRelayAgentIdentity(request: Request): HarnessRelayAgentIdentity | null {
  const rawReleaseVersion = request.headers.get(HARNESS_RELAY_AGENT_RELEASE_VERSION_HEADER);
  const rawFeatureVersion = request.headers.get(HARNESS_RELAY_AGENT_FEATURE_VERSION_HEADER);
  if (rawReleaseVersion === null && rawFeatureVersion === null) return null;
  if (rawReleaseVersion === null || rawFeatureVersion === null) {
    return invalidIdentity("agent relay identity must include release and feature versions");
  }

  const releaseVersion = normalizeAgentReleaseVersion(rawReleaseVersion);
  if (!releaseVersion) return invalidIdentity("agent relay release version must be a stable release version");
  if (!FEATURE_VERSION_PATTERN.test(rawFeatureVersion)) {
    return invalidIdentity("agent relay feature version must be a nonnegative integer");
  }
  const featureVersion = Number(rawFeatureVersion);
  if (!Number.isSafeInteger(featureVersion) || featureVersion > MAX_AGENT_FEATURE_VERSION) {
    return invalidIdentity("agent relay feature version must be a nonnegative integer");
  }
  return { releaseVersion, featureVersion };
}

function storedFeatureVersion(value: number | null): number | null {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_AGENT_FEATURE_VERSION
  )
    ? value
    : null;
}

function storedFeatureRequiresIdentity(value: number | null): boolean {
  // Any corrupt non-null value must never reopen the legacy no-identity path.
  // It is treated as unknown only for monotonic comparison so a valid Agent
  // can repair it in the same transaction.
  const featureVersion = storedFeatureVersion(value);
  return (
    value !== null &&
    (featureVersion === null || featureVersion >= MIN_HARNESS_REPORTER_IDENTITY_AGENT_FEATURE_VERSION)
  );
}

/** An identity can never move a known Device dimension backwards. */
function identityIsAtLeast(
  current: StoredAgentIdentity,
  incoming: HarnessRelayAgentIdentity
): boolean {
  const currentReleaseVersion = normalizeAgentReleaseVersion(current.agentReleaseVersion);
  if (currentReleaseVersion) {
    const releaseComparison = compareAgentReleaseVersion(incoming.releaseVersion, currentReleaseVersion);
    if (releaseComparison === null || releaseComparison < 0) return false;
  }

  const currentFeatureVersion = storedFeatureVersion(current.agentFeatureVersion);
  return currentFeatureVersion === null || incoming.featureVersion >= currentFeatureVersion;
}

function identityNeedsPersisting(current: StoredAgentIdentity, incoming: HarnessRelayAgentIdentity): boolean {
  return (
    normalizeAgentReleaseVersion(current.agentReleaseVersion) !== incoming.releaseVersion ||
    storedFeatureVersion(current.agentFeatureVersion) !== incoming.featureVersion
  );
}

function staleRelayIdentity(): never {
  // Keep the control-plane refusal code aligned with /api/harness/report so
  // the Agent can surface one actionable upgrade condition for both paths.
  throw new HarnessApiInputError(
    "stale_agent_report",
    "agent reporter identity is older than the device's accepted Agent",
    409
  );
}

/**
 * Serialize every device-driven Harness relay behind the Device row and a
 * fresh token check. A force-enrollment revocation therefore fences a request
 * that authenticated just before rotation, and an old daemon reruns its guard
 * after a newer Agent has established capability-9 identity.
 */
export async function withHarnessRelayIdentity<T>(
  token: RelayDeviceToken,
  identity: HarnessRelayAgentIdentity | null,
  operation: ({ tx, now }: HarnessRelayTransaction) => Promise<T>
): Promise<T> {
  return retrySerializableTransaction(() =>
    prisma.$transaction(
      async (tx) => {
        // Match report's Device -> DeviceToken lock order. Enrollment revokes
        // tokens after upserting the Device in the same order.
        const lockedDevice = await tx.device.updateMany({
          where: { id: token.deviceId, userId: token.userId },
          data: { lastSeenAt: new Date() }
        });
        if (lockedDevice.count !== 1) {
          throw new HarnessApiInputError("device_token_revoked", "device is no longer active", 401);
        }

        const activeToken = await tx.deviceToken.updateMany({
          where: { id: token.id, deviceId: token.deviceId, userId: token.userId, revokedAt: null },
          data: { lastUsedAt: new Date() }
        });
        if (activeToken.count !== 1) {
          throw new HarnessApiInputError("device_token_revoked", "device token is no longer active", 401);
        }

        const current = await tx.device.findUnique({
          where: { id: token.deviceId },
          select: { agentReleaseVersion: true, agentFeatureVersion: true }
        });
        if (!current) {
          throw new HarnessApiInputError("device_token_revoked", "device is no longer active", 401);
        }

        const identityRequired = storedFeatureRequiresIdentity(current.agentFeatureVersion);
        if (identityRequired && !identity) staleRelayIdentity();

        if (identity) {
          if (!identityIsAtLeast(current, identity)) staleRelayIdentity();
          if (identityNeedsPersisting(current, identity)) {
            await tx.device.updateMany({
              where: { id: token.deviceId, userId: token.userId },
              data: {
                agentReleaseVersion: identity.releaseVersion,
                agentFeatureVersion: identity.featureVersion
              }
            });
          }
        }

        // The relay's expiration and marker timestamps must be taken after
        // locks and any serializable retry, not when the HTTP request began.
        return operation({ tx, now: new Date() });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
