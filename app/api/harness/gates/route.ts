import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/server/db";
import { HarnessSigningKeyMissingError, signDecision } from "@/server/harness-sign";
import type { HarnessDecisionPayload } from "@/server/harness-sign";

export const dynamic = "force-dynamic";

/**
 * 人闸门 API（网页端，next-auth 会话鉴权）。
 *
 * GET  列出本人所有待批 / 已批闸门
 * POST 批准或驳回 —— 控制台**唯一的写操作**。签名后落库，由 device agent 拉走中继到机器。
 *
 * 红线：控制台不写 status / features / autonomy-policy —— 推进键仍在机器侧。
 * 这里写下的只是一条**签名过的批准**，机器验签后自行执行迁移。
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const gates = await prisma.harnessGate.findMany({
    where: { userId: session.user.id, consumedAt: null },
    include: {
      harnessProject: {
        select: { id: true, name: true, repoKey: true, batch: true, status: true, deviceId: true }
      }
    },
    orderBy: [{ decisionAt: "asc" }, { raisedAt: "asc" }]
  });

  return Response.json({
    gates: gates.map((g) => ({
      id: g.id,
      gateId: g.gateId,
      kind: g.kind,
      batch: g.batch,
      fromStatus: g.fromStatus,
      toStatus: g.toStatus,
      detail: g.detail,
      evidence: g.evidence ?? [],
      raisedAt: g.raisedAt,
      raisedBy: g.raisedBy,
      project: g.harnessProject,
      decision: g.decisionAction
        ? {
            action: g.decisionAction,
            by: g.decisionBy,
            at: g.decisionAt,
            note: g.decisionNote,
            relayedAt: g.relayedAt
          }
        : null
    }))
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { id?: string; action?: string; note?: string }
    | null;
  const id = body?.id?.trim();
  const action = body?.action;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  if (action !== "approve" && action !== "reject") {
    return Response.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const gate = await prisma.harnessGate.findFirst({
    where: { id, userId: session.user.id }
  });
  if (!gate) return Response.json({ error: "gate not found" }, { status: 404 });
  if (gate.decisionAction) {
    return Response.json(
      { error: `already ${gate.decisionAction} by ${gate.decisionBy ?? "unknown"}` },
      { status: 409 }
    );
  }
  if (gate.consumedAt) {
    return Response.json({ error: "gate already consumed by the machine" }, { status: 409 });
  }

  // 归属：批准必须记名。优先用邮箱，回落到用户名/ id。
  const by = session.user.email || session.user.name || session.user.id;
  const at = new Date();
  const note = body?.note?.trim() || undefined;

  const payload: HarnessDecisionPayload = {
    gate_id: gate.gateId,
    action,
    by,
    at: at.toISOString(),
    ...(note ? { note } : {}),
    scope: { once: true }        // 最小授权：只批这一次这一个闸门
  };

  let sig: string;
  try {
    sig = signDecision(payload);
  } catch (e) {
    if (e instanceof HarnessSigningKeyMissingError) {
      // fail-closed：签不了就不落库。落一条无签名的决策等于给机器一条无法验证来源的批准。
      return Response.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }

  const updated = await prisma.harnessGate.updateMany({
    where: {
      id: gate.id,
      userId: session.user.id,
      decisionAction: null,
      consumedAt: null
    },
    data: {
      decisionAction: action,
      decisionBy: by,
      decisionAt: at,
      decisionNote: note ?? null,
      decisionOnce: true,
      decisionSig: sig
    }
  });
  if (updated.count !== 1) {
    return Response.json({ error: "gate is no longer pending" }, { status: 409 });
  }

  return Response.json({
    ok: true,
    id: gate.id,
    action,
    by,
    at: at.toISOString(),
    note: note ?? null,
    sig,
    // 提醒：批准只是签发，机器要等 agent 下次心跳取走才生效
    pendingRelay: true
  });
}
