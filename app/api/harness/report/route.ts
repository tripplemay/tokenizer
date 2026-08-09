import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  HARNESS_REPORT_MAX_BYTES,
  HarnessApiInputError,
  harnessInputErrorResponse,
  parseDispatchRuns,
  parseModeDefaultsSummary,
  parseModeIntentSummary,
  parseModeSnapshot,
  parseUtcDate,
  readBoundedJson,
  safePersistedSummary,
  type HarnessDispatchRunInput,
  type ReportModeDefaultsSummary,
  type ReportModeIntentSummary
} from "@/server/harness-mode-intent-api";
import { compareAgentReleaseVersion, normalizeAgentReleaseVersion } from "@/shared/agent-release-version";
import {
  MAX_AGENT_FEATURE_VERSION,
  MIN_HARNESS_REPORTER_IDENTITY_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";
import { normalizeHarnessRepoKey } from "@/shared/harness-mode-intent";
import { retrySerializableTransaction } from "@/server/serializable-transaction";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type ParsedState = {
  status: string | null;
  batch: string | null;
  fixRounds: number;
  completed: number;
  total: number;
  headSha: string | null;
  signoff: string | null;
  dashboardUrl: string | null;
  autonomyStatus: string | null;
  lastHalt: { condition: string | null; detail: string | null } | null;
  features: Array<{ id: string | null; title: string | null; status: string | null; executor: string | null }>;
  modes: UnknownRecord | null;
  modeDefaults: ReportModeDefaultsSummary | null;
  modeIntent: ReportModeIntentSummary | null;
};

type ParsedGate = {
  id: string;
  kind: string;
  batch: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detail: string;
  evidence: string[];
  raisedAt: Date | null;
  raisedBy: string;
};

type ParsedAgentReporter = {
  releaseVersion: string;
  featureVersion: number;
};

type ParsedReport = {
  repoKey: string;
  name: string;
  agent: ParsedAgentReporter | null;
  state: ParsedState;
  gate: ParsedGate | null;
  dispatchRuns: HarnessDispatchRunInput[];
};

const GATE_KINDS = new Set([
  "phase_advance",
  "l2_auth",
  "adjudication",
  "debias_conflict",
  "scope_drift",
  "budget",
  "spec_lock",
  "other"
]);
const OPAQUE_LOCAL_REPO_KEY_PATTERN = /^local:sha256:[0-9a-fA-F]{64}$/;
function reject(code: string, message: string): never {
  throw new HarnessApiInputError(code, message);
}

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_type", `${label} must be an object`);
  }
  return value as UnknownRecord;
}

function exactRecord(value: unknown, label: string, allowedFields: readonly string[]): UnknownRecord {
  const result = record(value, label);
  const allowed = new Set(allowedFields);
  if (Object.keys(result).some((key) => !allowed.has(key))) {
    return reject("unknown_field", `${label} contains unsupported fields`);
  }
  return result;
}

function stringValue(value: unknown, label: string, max: number, nullable = false): string | null {
  const result = safePersistedSummary(value, label, max);
  if (result === null && !nullable) return reject("invalid_string", `${label} must be a string`);
  return result;
}

function countValue(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    return reject("invalid_number", `${label} must be a nonnegative integer`);
  }
  return value;
}

function canonicalRepoKey(value: string): string {
  // Local workspace identities are content-addressed opaque keys. They are not
  // Git remotes, so retain their shape while canonicalizing the hexadecimal
  // digest spelling to avoid a case-only duplicate identity.
  if (OPAQUE_LOCAL_REPO_KEY_PATTERN.test(value)) return value.toLowerCase();
  try {
    return normalizeHarnessRepoKey(value);
  } catch {
    return reject("invalid_repo_key", "repoKey must identify a repository");
  }
}

/**
 * Historical rows predate the report write-boundary normalization, so they
 * cannot be assumed valid. A malformed stored key is not a migration
 * candidate; it remains reachable only through its literal GET lookup.
 */
function canonicalStoredRepoKey(value: string): string | null {
  try {
    return canonicalRepoKey(value);
  } catch {
    return null;
  }
}

async function reissueOneLegacyApprovedGate(
  tx: Prisma.TransactionClient,
  scope: { userId: string; legacyProjectId: string; canonicalProjectId: string }
): Promise<void> {
  const gates = await tx.harnessGate.findMany({
    where: {
      userId: scope.userId,
      harnessProjectId: scope.legacyProjectId,
      decisionSig: { not: null },
      consumedAt: null
    },
    select: { id: true, gateId: true }
  });

  // A signed decision does not bind its repo wrapper. Preserve exact-only
  // delivery unless there is one unambiguous approved gate and no same-ID
  // gate on the canonical project.
  if (gates.length !== 1) return;
  const gate = gates[0];
  const canonicalGate = await tx.harnessGate.findUnique({
    where: {
      harnessProjectId_gateId: {
        harnessProjectId: scope.canonicalProjectId,
        gateId: gate.gateId
      }
    },
    select: { id: true }
  });
  if (canonicalGate) return;

  const moved = await tx.harnessGate.updateMany({
    where: {
      id: gate.id,
      userId: scope.userId,
      harnessProjectId: scope.legacyProjectId,
      decisionSig: { not: null },
      consumedAt: null
    },
    // Keep the original decision fields and signature byte-for-byte intact.
    // Only its trusted database wrapper moves to the equivalent canonical key.
    data: { harnessProjectId: scope.canonicalProjectId, relayedAt: null }
  });
  if (moved.count !== 1) {
    throw new HarnessApiInputError("repo_identity_conflict", "legacy gate changed during identity reconciliation", 409);
  }
}

/**
 * Reconcile a single pre-normalization HarnessProject identity before the
 * current report is written. The agent deliberately routes gate wrappers by
 * exact repoKey, so this server-side, proof-bound migration is the only place
 * a legacy alias may become the canonical identity.
 */
async function reconcileHarnessProjectIdentity(
  tx: Prisma.TransactionClient,
  scope: { userId: string; deviceId: string; repoKey: string }
): Promise<void> {
  const projects = await tx.harnessProject.findMany({
    where: { userId: scope.userId, deviceId: scope.deviceId },
    select: { id: true, userId: true, repoKey: true }
  });
  const canonicalProject = projects.find((project) => project.repoKey === scope.repoKey) ?? null;
  const legacyProjects = projects.filter(
    (project) => project.repoKey !== scope.repoKey && canonicalStoredRepoKey(project.repoKey) === scope.repoKey
  );

  if (legacyProjects.length === 0) return;
  if (canonicalProject) {
    // Keep historical observations in place. A single approved, unconsumed
    // Gate is the only child relation safe to reissue without merging two
    // histories or changing an already-signed decision payload.
    if (legacyProjects.length === 1) {
      await reissueOneLegacyApprovedGate(tx, {
        userId: scope.userId,
        legacyProjectId: legacyProjects[0].id,
        canonicalProjectId: canonicalProject.id
      });
    }
    return;
  }
  if (legacyProjects.length > 1) {
    throw new HarnessApiInputError(
      "repo_identity_ambiguous",
      "multiple legacy harness project identities match this repository",
      409
    );
  }

  const legacyProject = legacyProjects[0];

  // The scoped scan intentionally excludes other users' rows. Check the
  // device-wide unique key before re-keying so a malformed cross-tenant row
  // fails closed instead of surfacing as an unhandled unique violation.
  const existingCanonicalProject = await tx.harnessProject.findUnique({
    where: { deviceId_repoKey: { deviceId: scope.deviceId, repoKey: scope.repoKey } },
    select: { id: true, userId: true }
  });
  if (existingCanonicalProject) {
    if (existingCanonicalProject.userId !== scope.userId) {
      throw new HarnessApiInputError("project_ownership_conflict", "harness project ownership conflict", 403);
    }
    throw new HarnessApiInputError(
      "repo_identity_conflict",
      "legacy and canonical harness project identities cannot be merged automatically",
      409
    );
  }

  // Re-keying preserves the same parent ID and every child relation. Reset
  // only pending gates relayed under the obsolete wrapper, allowing one fresh
  // canonical delivery to the exact-only Agent.
  await tx.harnessProject.update({ where: { id: legacyProject.id }, data: { repoKey: scope.repoKey } });
  await tx.harnessGate.updateMany({
    where: {
      userId: scope.userId,
      harnessProjectId: legacyProject.id,
      consumedAt: null,
      relayedAt: { not: null }
    },
    data: { relayedAt: null }
  });
}

function parseFeatures(value: unknown): ParsedState["features"] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) {
    return reject("invalid_features", "state.features must contain at most 500 entries");
  }
  return value.map((rawFeature) => {
    const feature = exactRecord(rawFeature, "feature", ["id", "title", "status", "executor"]);
    return {
      id: stringValue(feature.id, "feature.id", 128, true),
      title: stringValue(feature.title, "feature.title", 256, true),
      status: stringValue(feature.status, "feature.status", 64, true),
      executor: stringValue(feature.executor, "feature.executor", 64, true)
    };
  });
}

function parseModes(value: unknown): UnknownRecord | null {
  return parseModeSnapshot(value);
}

function parseLastHalt(value: unknown): ParsedState["lastHalt"] {
  if (value === undefined || value === null) return null;
  const halt = exactRecord(value, "state.lastHalt", ["condition", "detail"]);
  return {
    condition: stringValue(halt.condition, "state.lastHalt.condition", 128, true),
    detail: stringValue(halt.detail, "state.lastHalt.detail", 1_000, true)
  };
}

function parseState(value: unknown, topLevel: UnknownRecord): ParsedState {
  const state =
    value === undefined || value === null
      ? {}
      : exactRecord(value, "state", [
          "status",
          "batch",
          "fixRounds",
          "completed",
          "total",
          "headSha",
          "signoff",
          "dashboardUrl",
          "autonomyStatus",
          "lastHalt",
          "features",
          "modes",
          "modeDefaults",
          "modeIntent"
        ]);
  const rawHeadSha = stringValue(state.headSha, "state.headSha", 40, true);
  if (rawHeadSha !== null && !/^[0-9a-fA-F]{7,40}$/.test(rawHeadSha)) {
    return reject("invalid_head_sha", "state.headSha must contain 7 to 40 hexadecimal characters");
  }
  return {
    status: stringValue(state.status, "state.status", 64, true),
    batch: stringValue(state.batch, "state.batch", 128, true),
    fixRounds: countValue(state.fixRounds, "state.fixRounds"),
    completed: countValue(state.completed, "state.completed"),
    total: countValue(state.total, "state.total"),
    headSha: rawHeadSha?.toLowerCase() ?? null,
    signoff: stringValue(state.signoff, "state.signoff", 512, true),
    dashboardUrl: stringValue(state.dashboardUrl, "state.dashboardUrl", 2_048, true),
    autonomyStatus: stringValue(state.autonomyStatus, "state.autonomyStatus", 64, true),
    lastHalt: parseLastHalt(state.lastHalt),
    features: parseFeatures(state.features),
    modes: parseModes(state.modes),
    // F004 writes these under state. Top-level aliases keep the report endpoint tolerant
    // while old agents continue omitting both fields entirely.
    modeDefaults: parseModeDefaultsSummary(state.modeDefaults ?? topLevel.modeDefaults),
    modeIntent: parseModeIntentSummary(state.modeIntent ?? topLevel.modeIntent)
  };
}

function parseGate(value: unknown): ParsedGate | null {
  if (value === undefined || value === null) return null;
  const gate = record(value, "gate");
  const allowed = new Set([
    "id",
    "kind",
    "batch",
    "from_status",
    "to_status",
    "detail",
    "evidence",
    "raised_at",
    "raised_by"
  ]);
  if (Object.keys(gate).some((key) => !allowed.has(key))) {
    return reject("unknown_field", "gate contains unsupported fields");
  }
  const kind = stringValue(gate.kind, "gate.kind", 64)!;
  if (!GATE_KINDS.has(kind)) return reject("invalid_gate_kind", "gate.kind is not recognized");
  const rawEvidence = gate.evidence;
  if (rawEvidence !== undefined && (!Array.isArray(rawEvidence) || rawEvidence.length > 50)) {
    return reject("invalid_evidence", "gate.evidence must contain at most 50 entries");
  }
  const evidence = (Array.isArray(rawEvidence) ? rawEvidence : []).map((item: unknown) =>
    stringValue(item, "gate.evidence item", 512)!
  );
  return {
    id: stringValue(gate.id, "gate.id", 128)!,
    kind,
    batch: stringValue(gate.batch, "gate.batch", 128, true),
    fromStatus: stringValue(gate.from_status, "gate.from_status", 64, true),
    toStatus: stringValue(gate.to_status, "gate.to_status", 64, true),
    detail: stringValue(gate.detail, "gate.detail", 2_000)!,
    evidence,
    raisedAt: gate.raised_at === undefined ? null : parseUtcDate(gate.raised_at, "gate.raised_at"),
    raisedBy: stringValue(gate.raised_by ?? "autodriver", "gate.raised_by", 128)!
  };
}

function parseAgentReporter(value: unknown): ParsedAgentReporter | null {
  if (value === undefined || value === null) return null;
  const reporter = exactRecord(value, "agent", ["releaseVersion", "featureVersion"]);
  if (
    !Object.prototype.hasOwnProperty.call(reporter, "releaseVersion") ||
    !Object.prototype.hasOwnProperty.call(reporter, "featureVersion")
  ) {
    return reject("invalid_agent_reporter", "agent must include releaseVersion and featureVersion");
  }
  const rawReleaseVersion = stringValue(reporter.releaseVersion, "agent.releaseVersion", 64)!;
  const releaseVersion = normalizeAgentReleaseVersion(rawReleaseVersion);
  if (!releaseVersion) {
    return reject("invalid_agent_reporter", "agent.releaseVersion must be a stable release version");
  }
  const featureVersion = reporter.featureVersion;
  if (
    typeof featureVersion !== "number" ||
    !Number.isSafeInteger(featureVersion) ||
    featureVersion < 0 ||
    featureVersion > MAX_AGENT_FEATURE_VERSION
  ) {
    return reject("invalid_agent_reporter", "agent.featureVersion must be a nonnegative integer");
  }
  return { releaseVersion, featureVersion };
}

function reporterCanWriteHarness(
  current: { agentReleaseVersion: string | null; agentFeatureVersion: number | null },
  reporter: ParsedAgentReporter | null
): boolean {
  const currentFeatureVersion =
    typeof current.agentFeatureVersion === "number" &&
    Number.isSafeInteger(current.agentFeatureVersion) &&
    current.agentFeatureVersion >= 0 &&
    current.agentFeatureVersion <= MAX_AGENT_FEATURE_VERSION
      ? current.agentFeatureVersion
      : null;
  // The legacy compatibility branch is exclusively for pre-identity clients.
  // Once an Agent supplies identity, compare every known dimension even when
  // the stored capability is below 9; otherwise an identified old process
  // could still downgrade a pre-v9 Device row.
  if (!reporter) {
    if (current.agentFeatureVersion !== null && currentFeatureVersion === null) return false;
    return (currentFeatureVersion ?? 0) < MIN_HARNESS_REPORTER_IDENTITY_AGENT_FEATURE_VERSION;
  }

  if (currentFeatureVersion !== null && reporter.featureVersion < currentFeatureVersion) return false;
  const currentReleaseVersion = normalizeAgentReleaseVersion(current.agentReleaseVersion);
  if (!currentReleaseVersion) return true;
  const comparison = compareAgentReleaseVersion(reporter.releaseVersion, currentReleaseVersion);
  return comparison !== null && comparison >= 0;
}

function reporterPromotesDevice(
  current: { agentReleaseVersion: string | null; agentFeatureVersion: number | null },
  reporter: ParsedAgentReporter | null
): reporter is ParsedAgentReporter {
  if (!reporter) return false;
  const currentReleaseVersion = normalizeAgentReleaseVersion(current.agentReleaseVersion);
  const releaseIsNewer =
    !currentReleaseVersion || compareAgentReleaseVersion(reporter.releaseVersion, currentReleaseVersion) !== 0;
  const currentFeatureVersion =
    typeof current.agentFeatureVersion === "number" &&
    Number.isSafeInteger(current.agentFeatureVersion) &&
    current.agentFeatureVersion >= 0 &&
    current.agentFeatureVersion <= MAX_AGENT_FEATURE_VERSION
      ? current.agentFeatureVersion
      : null;
  const featureIsNewer = currentFeatureVersion === null || reporter.featureVersion !== currentFeatureVersion;
  return releaseIsNewer || featureIsNewer;
}

function parseReport(value: unknown): ParsedReport {
  const body = exactRecord(value, "request", [
    "repoKey",
    "name",
    "agent",
    "state",
    "gate",
    "dispatchRuns",
    "modeDefaults",
    "modeIntent"
  ]);
  return {
    // The client already emits this spelling, but the server is the durable
    // identity boundary. Do not create a second device report for an HTTPS,
    // SSH, or case-only alias of the same remote.
    repoKey: canonicalRepoKey(stringValue(body.repoKey, "repoKey", 512)!),
    name: stringValue(body.name, "name", 200)!,
    agent: parseAgentReporter(body.agent),
    state: parseState(body.state, body),
    gate: parseGate(body.gate),
    dispatchRuns: parseDispatchRuns(body.dispatchRuns)
  };
}

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  let report: ParsedReport;
  try {
    report = parseReport(await readBoundedJson(request, HARNESS_REPORT_MAX_BYTES));
  } catch (error) {
    return harnessInputErrorResponse(error);
  }

  const now = new Date();
  const linked = await prisma.project.findFirst({
    where: { userId: token.userId, repoKey: report.repoKey },
    select: { id: true }
  });

  let result: { projectId: string };
  try {
    result = await retrySerializableTransaction(() =>
      prisma.$transaction(
      async (tx) => {
        // A report is liveness activity, so advancing lastSeenAt is accurate.
        // More importantly, this locks the Device row before reading its
        // accepted identity. A concurrent heartbeat either waits behind this
        // report or causes a serializable retry, which closes the old-report /
        // new-heartbeat snapshot window. Device must be locked before token:
        // heartbeat and enrollment use this same order, avoiding a lock-order
        // deadlock while force-enroll rotates credentials.
        const lockedDevice = await tx.device.updateMany({
          where: { id: token.deviceId, userId: token.userId },
          data: { lastSeenAt: now }
        });
        if (lockedDevice.count !== 1) {
          throw new HarnessApiInputError("device_token_revoked", "device is no longer active", 401);
        }

        // Authentication happens before the transaction. This conditional
        // update rechecks that enrollment has not revoked the token and fences
        // a concurrent credential rotation before any Harness write.
        const activeToken = await tx.deviceToken.updateMany({
          where: { id: token.id, deviceId: token.deviceId, userId: token.userId, revokedAt: null },
          data: { lastUsedAt: now }
        });
        if (activeToken.count !== 1) {
          throw new HarnessApiInputError("device_token_revoked", "device token is no longer active", 401);
        }

        // This must precede identity reconciliation and all Harness writes.
        // A lingering pre-upgrade daemon may report liveness, but cannot
        // replace a mode catalog, pending gate, intent ACK, or dispatch
        // history from a newer accepted Agent.
        const currentDevice = await tx.device.findUnique({
          where: { id: token.deviceId },
          select: { agentReleaseVersion: true, agentFeatureVersion: true }
        });
        if (!currentDevice) {
          throw new HarnessApiInputError("device_token_revoked", "device is no longer active", 401);
        }
        if (!reporterCanWriteHarness(currentDevice, report.agent)) {
          throw new HarnessApiInputError(
            "stale_agent_report",
            "agent reporter identity is older than the device's accepted Agent",
            409
          );
        }

        // `tokenizer harness` can run independently of the background
        // heartbeat. Once a versioned report is accepted, persist that
        // identity in the same serializable transaction before any control
        // plane write. Otherwise a legacy identity-less report could still
        // enter the capability-8 compatibility path immediately afterwards.
        if (reporterPromotesDevice(currentDevice, report.agent)) {
          await tx.device.updateMany({
            where: { id: token.deviceId, userId: token.userId },
            data: {
              agentReleaseVersion: report.agent.releaseVersion,
              agentFeatureVersion: report.agent.featureVersion
            }
          });
        }

        await reconcileHarnessProjectIdentity(tx, {
          userId: token.userId,
          deviceId: token.deviceId,
          repoKey: report.repoKey
        });

        const state = report.state;
        const data = {
          name: report.name,
          projectId: linked?.id ?? null,
          status: state.status,
          batch: state.batch,
          fixRounds: state.fixRounds,
          completedCount: state.completed,
          totalCount: state.total,
          headSha: state.headSha,
          signoff: state.signoff,
          dashboardUrl: state.dashboardUrl,
          autonomyStatus: state.autonomyStatus,
          lastHaltCondition: state.lastHalt?.condition ?? null,
          lastHaltDetail: state.lastHalt?.detail ?? null,
          features: state.features as Prisma.InputJsonValue,
          modes: state.modes === null ? Prisma.JsonNull : (state.modes as Prisma.InputJsonValue),
          reportedAt: now
        };

        const projectKey = { deviceId: token.deviceId, repoKey: report.repoKey };
        const existingProject = await tx.harnessProject.findUnique({
          where: { deviceId_repoKey: projectKey },
          select: { id: true, userId: true, status: true, batch: true, reportedAt: true }
        });
        if (existingProject && existingProject.userId !== token.userId) {
          throw new HarnessApiInputError("project_ownership_conflict", "harness project ownership conflict", 403);
        }

        const project = await tx.harnessProject.upsert({
          where: { deviceId_repoKey: projectKey },
          create: { userId: token.userId, deviceId: token.deviceId, repoKey: report.repoKey, ...data },
          update: data
        });
        if (project.userId !== token.userId || (existingProject !== null && project.id !== existingProject.id)) {
          throw new HarnessApiInputError("project_ownership_conflict", "harness project ownership conflict", 403);
        }

        // 流转事件差分（BL-TRANSITION-LOG F001）：镜像观测日志，权威真相仍是 progress.json 的
        // git 历史。新 status 为 null（progress.json 不可读的降级镜像）不算流转；同状态重复上报
        // 零写入，serializable 重试整体回滚不产生重复行。
        if (state.status !== null) {
          const initialObservation = existingProject === null || existingProject.status === null;
          const changed =
            !initialObservation &&
            (existingProject.status !== state.status || existingProject.batch !== state.batch);
          if (initialObservation || changed) {
            await tx.harnessTransition.create({
              data: {
                userId: token.userId,
                harnessProjectId: project.id,
                fromStatus: initialObservation ? null : existingProject.status,
                toStatus: state.status,
                fromBatch: existingProject?.batch ?? null,
                toBatch: state.batch,
                batchBoundary: !initialObservation && existingProject.batch !== state.batch,
                fixRounds: state.fixRounds,
                headSha: state.headSha,
                observedAfter: existingProject?.reportedAt ?? null,
                observedAt: now
              }
            });
          }
        }

        const gate = report.gate;
        if (gate) {
          const raisedAt = gate.raisedAt ?? now;
          const shape = {
            kind: gate.kind,
            batch: gate.batch ?? project.batch ?? "",
            fromStatus: gate.fromStatus,
            toStatus: gate.toStatus,
            detail: gate.detail,
            evidence: gate.evidence as Prisma.InputJsonValue,
            raisedAt,
            raisedBy: gate.raisedBy
          };
          const existing = await tx.harnessGate.findUnique({
            where: { harnessProjectId_gateId: { harnessProjectId: project.id, gateId: gate.id } }
          });
          if (existing?.consumedAt && raisedAt > existing.raisedAt) {
            await tx.harnessGate.updateMany({
              where: { id: existing.id, harnessProjectId: project.id, userId: token.userId },
              data: {
                ...shape,
                decisionAction: null,
                decisionBy: null,
                decisionAt: null,
                decisionNote: null,
                decisionOnce: true,
                decisionSig: null,
                relayedAt: null,
                consumedAt: null
              }
            });
          } else {
            await tx.harnessGate.upsert({
              where: { harnessProjectId_gateId: { harnessProjectId: project.id, gateId: gate.id } },
              create: { userId: token.userId, harnessProjectId: project.id, gateId: gate.id, ...shape },
              update: { detail: gate.detail, evidence: gate.evidence as Prisma.InputJsonValue }
            });
          }
        } else {
          await tx.harnessGate.updateMany({
            where: {
              userId: token.userId,
              harnessProjectId: project.id,
              consumedAt: null,
              relayedAt: { not: null }
            },
            data: { consumedAt: now }
          });
        }

        if (state.modeDefaults) {
          await tx.harnessModeIntent.updateMany({
            where: {
              userId: token.userId,
              harnessProjectId: project.id,
              intentId: state.modeDefaults.intentId,
              status: { in: ["issued", "relayed"] },
              intentExpiresAt: { gt: state.modeDefaults.stagedAt }
            },
            data: {
              status: "staged",
              stagedAt: state.modeDefaults.stagedAt,
              stagedCommitSha: state.modeDefaults.stagedCommitSha
            }
          });
        }

        if (state.modeIntent) {
          await tx.harnessModeIntent.updateMany({
            where: {
              userId: token.userId,
              harnessProjectId: project.id,
              intentId: state.modeIntent.intentId,
              status: { in: ["issued", "relayed", "staged"] }
            },
            data: {
              status: "applied",
              appliedAt: state.modeIntent.appliedAt,
              appliedBatch: state.modeIntent.appliedBatch
            }
          });
        }

        for (const run of report.dispatchRuns) {
          const runData = {
            taskId: run.taskId,
            batch: run.batch,
            feature: run.feature,
            role: run.role,
            agentId: run.agentId,
            modelFamily: run.modelFamily,
            transport: run.transport,
            lockedSha: run.lockedSha,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            durationMs: run.durationMs,
            outcome: run.outcome,
            exitCode: run.exitCode,
            verdict: run.verdict,
            artifactPath: run.artifactPath,
            artifactSha256: run.artifactSha256,
            errorSummary: run.errorSummary
          };
          await tx.harnessDispatchRun.upsert({
            where: { harnessProjectId_runId: { harnessProjectId: project.id, runId: run.runId } },
            create: {
              userId: token.userId,
              harnessProjectId: project.id,
              runId: run.runId,
              ...runData
            },
            update: runData
          });
        }

        return { projectId: project.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  } catch (error) {
    if (error instanceof HarnessApiInputError) return harnessInputErrorResponse(error);
    throw error;
  }

  return Response.json({
    ok: true,
    harnessProjectId: result.projectId,
    linkedProjectId: linked?.id ?? null,
    dispatchRuns: report.dispatchRuns.length
  });
}

export async function GET(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();
  const rawRepoKey = new URL(request.url).searchParams.get("repoKey")?.trim();
  if (!rawRepoKey || rawRepoKey.length > 512) return forbidden("repoKey is required");

  // Preserve access to rows written before write-boundary normalization. New
  // callers can still find their canonical row after the exact lookup misses.
  const exactProject = await prisma.harnessProject.findFirst({
    where: { deviceId: token.deviceId, userId: token.userId, repoKey: rawRepoKey }
  });
  if (exactProject) return Response.json({ project: exactProject });

  let repoKey: string;
  try {
    repoKey = canonicalRepoKey(rawRepoKey);
  } catch {
    // GET historically treated any bounded query value as a literal lookup.
    // Keep that behavior when no canonical fallback can be derived.
    return Response.json({ project: null });
  }
  if (repoKey !== rawRepoKey) {
    const canonicalProject = await prisma.harnessProject.findFirst({
      where: { deviceId: token.deviceId, userId: token.userId, repoKey }
    });
    if (canonicalProject) return Response.json({ project: canonicalProject });
  }

  // Canonical callers must also be able to inspect a single legacy row until
  // its next report writes through the transactional migration above. More
  // than one alias is deliberately ambiguous rather than picked arbitrarily.
  const legacyProjects = await prisma.harnessProject.findMany({
    where: { deviceId: token.deviceId, userId: token.userId }
  });
  const matchingLegacyProjects = legacyProjects.filter(
    (project) => project.repoKey !== repoKey && canonicalStoredRepoKey(project.repoKey) === repoKey
  );
  return Response.json({ project: matchingLegacyProjects.length === 1 ? matchingLegacyProjects[0] : null });
}
