import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/server/db";
import {
  HARNESS_API_MAX_BYTES,
  HARNESS_MODE_INTENT_ACTIVE_STATUSES,
  harnessInputErrorResponse,
  modeAgentsFromSnapshot,
  modeToolCatalogFromSnapshot,
  parseCancelModeIntentInput,
  parseIssueModeIntentInput,
  parseProjectIdFromUrl,
  readBoundedJson
} from "@/server/harness-mode-intent-api";
import { signHarnessPayload } from "@/server/harness-sign";
import {
  HarnessModeIntentValidationError,
  normalizeHarnessModeIntentPayload,
  requiresHarnessToolCatalog,
  usesHarnessToolBindings,
  type HarnessModeIntentPayload
} from "@/shared/harness-mode-intent";
import { DEVICE_ONLINE_MS } from "@/shared/device-status";
import {
  MIN_MODE_INTENT_AGENT_FEATURE_VERSION,
  MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION
} from "@/shared/agent-feature-version";

export const dynamic = "force-dynamic";

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function notFound() {
  return Response.json({ error: "harness project not found" }, { status: 404 });
}

function serializeIntent(intent: {
  id: string;
  intentId: string;
  payload: unknown;
  signature: string;
  status: string;
  issuedBy: string;
  issuedAt: Date;
  intentExpiresAt: Date;
  relayedAt: Date | null;
  stagedAt: Date | null;
  appliedAt: Date | null;
  failedAt: Date | null;
  appliedBatch: string | null;
  stagedCommitSha: string | null;
  failureCode: string | null;
  failureDetail: string | null;
}) {
  return {
    id: intent.id,
    intentId: intent.intentId,
    payload: intent.payload,
    signature: intent.signature,
    status: intent.status,
    issuedBy: intent.issuedBy,
    issuedAt: intent.issuedAt.toISOString(),
    intentExpiresAt: intent.intentExpiresAt.toISOString(),
    relayedAt: intent.relayedAt?.toISOString() ?? null,
    stagedAt: intent.stagedAt?.toISOString() ?? null,
    appliedAt: intent.appliedAt?.toISOString() ?? null,
    failedAt: intent.failedAt?.toISOString() ?? null,
    appliedBatch: intent.appliedBatch,
    stagedCommitSha: intent.stagedCommitSha,
    failureCode: intent.failureCode,
    failureDetail: intent.failureDetail
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let projectId: string;
  try {
    projectId = parseProjectIdFromUrl(request.url);
  } catch (error) {
    return harnessInputErrorResponse(error);
  }

  const project = await prisma.harnessProject.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true }
  });
  if (!project) return notFound();

  const intents = await prisma.harnessModeIntent.findMany({
    where: { harnessProjectId: project.id, userId: session.user.id },
    orderBy: { issuedAt: "desc" },
    take: 100
  });
  return Response.json({ intents: intents.map(serializeIntent) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let input;
  try {
    input = parseIssueModeIntentInput(await readBoundedJson(request, HARNESS_API_MAX_BYTES));
  } catch (error) {
    return harnessInputErrorResponse(error);
  }

  const project = await prisma.harnessProject.findFirst({
    where: { id: input.projectId, userId: session.user.id },
    select: {
      id: true,
      repoKey: true,
      headSha: true,
      reportedAt: true,
      modes: true,
      device: { select: { userId: true, agentFeatureVersion: true } }
    }
  });
  if (!project || project.device.userId !== session.user.id) return notFound();

  const now = new Date();
  const isV2ToolBindingIntent = usesHarnessToolBindings(input.desired);
  const needsToolCatalog = requiresHarnessToolCatalog(input.desired);
  if (
    !project.reportedAt ||
    project.reportedAt.getTime() > now.getTime() + 5 * 60 * 1000 ||
    now.getTime() - project.reportedAt.getTime() >= DEVICE_ONLINE_MS
  ) {
    return Response.json(
      { error: "project report is stale; wait for the device agent to report again", code: "stale_report" },
      { status: 409 }
    );
  }
  if ((project.device.agentFeatureVersion ?? 0) < MIN_MODE_INTENT_AGENT_FEATURE_VERSION) {
    return Response.json(
      { error: `device agent feature version ${MIN_MODE_INTENT_AGENT_FEATURE_VERSION} or newer is required`, code: "agent_upgrade_required" },
      { status: 409 }
    );
  }
  if (isV2ToolBindingIntent && (project.device.agentFeatureVersion ?? 0) < MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION) {
    return Response.json(
      {
        error: `device agent feature version ${MIN_TOOL_BINDING_MODE_INTENT_AGENT_FEATURE_VERSION} or newer is required for v2 mode intents`,
        code: "tool_binding_agent_upgrade_required"
      },
      { status: 409 }
    );
  }
  if (!project.headSha || !/^[0-9a-fA-F]{40}$/.test(project.headSha)) {
    return Response.json(
      { error: "project must report a full 40-character HEAD SHA", code: "invalid_project_head" },
      { status: 409 }
    );
  }

  let agents: ReturnType<typeof modeAgentsFromSnapshot> | undefined;
  let tools: ReturnType<typeof modeToolCatalogFromSnapshot> | undefined;
  try {
    // v2 binds a tool, not a concrete device-local agent. Legacy v1 intents
    // retain the old descriptor snapshot for backwards-compatible validation.
    if (!isV2ToolBindingIntent) agents = modeAgentsFromSnapshot(project.modes);
    tools = needsToolCatalog ? modeToolCatalogFromSnapshot(project.modes) : undefined;
  } catch (error) {
    return harnessInputErrorResponse(error);
  }
  if (needsToolCatalog && (!tools || tools.length === 0)) {
    return Response.json(
      { error: "project does not have a usable tool capability catalog", code: "invalid_tool_catalog" },
      { status: 409 }
    );
  }

  const issuedBy = (session.user.email || session.user.name || session.user.id).trim();
  if (!issuedBy || issuedBy.length > 256) {
    return Response.json({ error: "session identity is not usable", code: "invalid_identity" }, { status: 409 });
  }

  let payload: HarnessModeIntentPayload;
  try {
    payload = normalizeHarnessModeIntentPayload(
      {
        intent_id: randomUUID(),
        repo_key: project.repoKey,
        expected_head_sha: project.headSha,
        desired: input.desired,
        issued_by: issuedBy,
        issued_at: now.toISOString(),
        intent_expires_at: input.intentExpiresAt.toISOString()
      },
      { now, agents, tools }
    );
  } catch (error) {
    if (error instanceof HarnessModeIntentValidationError) {
      return Response.json(
        { error: "mode intent is invalid", code: error.code, path: error.path.slice(0, 128) },
        { status: 400 }
      );
    }
    return Response.json({ error: "mode intent is invalid", code: "invalid_intent" }, { status: 400 });
  }

  let signature: string;
  try {
    // Signing is deliberately completed before the transaction performs its first write.
    signature = signHarnessPayload(payload);
  } catch {
    return Response.json(
      { error: "mode intent signing is unavailable", code: "signing_unavailable" },
      { status: 503 }
    );
  }

  const created = await prisma.$transaction(
    async (tx) => {
      await tx.harnessModeIntent.updateMany({
        where: {
          harnessProjectId: project.id,
          userId: session.user.id,
          status: { in: [...HARNESS_MODE_INTENT_ACTIVE_STATUSES] }
        },
        data: { status: "superseded" }
      });
      return tx.harnessModeIntent.create({
        data: {
          userId: session.user.id,
          harnessProjectId: project.id,
          intentId: payload.intent_id,
          payload: payload as Prisma.InputJsonValue,
          signature,
          status: "issued",
          issuedBy: payload.issued_by,
          issuedAt: new Date(payload.issued_at),
          intentExpiresAt: new Date(payload.intent_expires_at)
        }
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  return Response.json({ intent: serializeIntent(created) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let input;
  try {
    input = parseCancelModeIntentInput(await readBoundedJson(request, HARNESS_API_MAX_BYTES));
  } catch (error) {
    return harnessInputErrorResponse(error);
  }

  const project = await prisma.harnessProject.findFirst({
    where: { id: input.projectId, userId: session.user.id },
    select: { id: true }
  });
  if (!project) return notFound();

  const intent = await prisma.harnessModeIntent.findFirst({
    where: {
      harnessProjectId: project.id,
      intentId: input.intentId,
      userId: session.user.id
    },
    select: { id: true, status: true }
  });
  if (!intent) return Response.json({ error: "mode intent not found" }, { status: 404 });
  if (intent.status !== "issued" && intent.status !== "relayed") {
    return Response.json(
      { error: "only issued or relayed mode intents can be canceled", code: "invalid_transition" },
      { status: 409 }
    );
  }

  const canceled = await prisma.harnessModeIntent.updateMany({
    where: {
      id: intent.id,
      harnessProjectId: project.id,
      userId: session.user.id,
      status: { in: ["issued", "relayed"] }
    },
    data: { status: "superseded" }
  });
  if (canceled.count !== 1) {
    return Response.json({ error: "mode intent state changed; retry", code: "state_conflict" }, { status: 409 });
  }
  return Response.json({ ok: true, intentId: input.intentId, status: "superseded" });
}
