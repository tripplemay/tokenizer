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

type ParsedReport = {
  repoKey: string;
  name: string;
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

function parseReport(value: unknown): ParsedReport {
  const body = exactRecord(value, "request", [
    "repoKey",
    "name",
    "state",
    "gate",
    "dispatchRuns",
    "modeDefaults",
    "modeIntent"
  ]);
  return {
    repoKey: stringValue(body.repoKey, "repoKey", 512)!,
    name: stringValue(body.name, "name", 200)!,
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
    result = await prisma.$transaction(
      async (tx) => {
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
          select: { id: true, userId: true }
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
  const repoKey = new URL(request.url).searchParams.get("repoKey")?.trim();
  if (!repoKey || repoKey.length > 512) return forbidden("repoKey is required");
  const project = await prisma.harnessProject.findFirst({
    where: { deviceId: token.deviceId, userId: token.userId, repoKey }
  });
  return Response.json({ project });
}
