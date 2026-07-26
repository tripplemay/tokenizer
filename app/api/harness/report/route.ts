import { NextRequest } from "next/server";
import { authenticateDeviceToken, forbidden, unauthorized } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * device agent 上报 harness 编排状态（progress.json / features.json 的镜像）。
 *
 * ⚠️ 这是**只读镜像**：真相源永远是机器上仓库里的 progress.json。本表渲染出错不影响状态机。
 * 上报是幂等的——按 (deviceId, repoKey) upsert，按 (harnessProjectId, gateId) 去重闸门。
 */

type ReportBody = {
  repoKey?: string;
  name?: string;
  state?: {
    status?: string | null;
    batch?: string | null;
    fixRounds?: number;
    completed?: number;
    total?: number;
    headSha?: string | null;
    signoff?: string | null;
    dashboardUrl?: string | null;
    autonomyStatus?: string | null;
    lastHalt?: { condition?: string | null; detail?: string | null } | null;
    features?: Array<{ id?: string; title?: string; status?: string; executor?: string }>;
    /** 模式指纹（agent 侧 harness-modes.ts 生成）。老 agent 不带这个字段，按 null 存。 */
    modes?: Record<string, unknown> | null;
  };
  gate?: {
    id?: string;
    kind?: string;
    batch?: string;
    from_status?: string | null;
    to_status?: string | null;
    detail?: string;
    evidence?: string[];
    raised_at?: string;
    raised_by?: string;
  } | null;
};

const GATE_KINDS = new Set([
  "phase_advance", "l2_auth", "adjudication", "debias_conflict",
  "scope_drift", "budget", "spec_lock", "other"
]);

export async function POST(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  const body = (await request.json().catch(() => null)) as ReportBody | null;
  const repoKey = body?.repoKey?.trim();
  if (!repoKey) return Response.json({ error: "repoKey is required" }, { status: 400 });
  if (!body?.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });

  const s = body.state ?? {};
  const now = new Date();

  // 把编排进度挂到已有的 Project 上（同 repoKey 口径），使「用量」与「进度」能对上。
  // 匹配不到不是错误——项目可能还没产生过用量事件。
  const linked = await prisma.project.findFirst({
    where: { userId: token.userId, repoKey },
    select: { id: true }
  });

  const data = {
    name: body.name.trim(),
    projectId: linked?.id ?? null,
    status: s.status ?? null,
    batch: s.batch ?? null,
    fixRounds: Number.isFinite(s.fixRounds) ? Number(s.fixRounds) : 0,
    completedCount: Number.isFinite(s.completed) ? Number(s.completed) : 0,
    totalCount: Number.isFinite(s.total) ? Number(s.total) : 0,
    headSha: s.headSha ?? null,
    signoff: s.signoff ?? null,
    dashboardUrl: s.dashboardUrl ?? null,
    autonomyStatus: s.autonomyStatus ?? null,
    lastHaltCondition: s.lastHalt?.condition ?? null,
    lastHaltDetail: s.lastHalt?.detail ?? null,
    features: (s.features ?? []) as object,
    // 老 agent 不上报 modes 时保持 null，而不是写成 {}——空对象会让页面误显示成
    // 「这个项目所有模式都关着」，而事实是「这台机器的 agent 还没升级」。
    modes: (s.modes ?? null) as object | null,
    reportedAt: now
  };

  const project = await prisma.harnessProject.upsert({
    where: { deviceId_repoKey: { deviceId: token.deviceId, repoKey } },
    create: { userId: token.userId, deviceId: token.deviceId, repoKey, ...data },
    update: data
  });

  const gate = body.gate ?? null;
  if (gate?.id && gate.kind && gate.detail) {
    if (!GATE_KINDS.has(gate.kind)) {
      return Response.json({ error: `unknown gate kind: ${gate.kind}` }, { status: 400 });
    }
    const raisedAt = gate.raised_at ? new Date(gate.raised_at) : now;
    const shape = {
      kind: gate.kind,
      batch: gate.batch ?? project.batch ?? "",
      fromStatus: gate.from_status ?? null,
      toStatus: gate.to_status ?? null,
      detail: gate.detail,
      evidence: (gate.evidence ?? []) as object,
      raisedAt,
      raisedBy: gate.raised_by ?? "autodriver"
    };
    const existing = await prisma.harnessGate.findUnique({
      where: { harnessProjectId_gateId: { harnessProjectId: project.id, gateId: gate.id } }
    });

    if (existing?.consumedAt && raisedAt > existing.raisedAt) {
      // 🔴 同一个 gate id 被**重新举起**（机器只上报还没有决策的闸门，所以这条上报就是
      // 「我又卡在这道闸门上了」）。库里那行已盖过消费戳，而待批列表按 consumedAt is null
      // 过滤——不重置的话控制台永远看不见它，人闸门死锁在一道谁也批不到的门上。
      // 用 raisedAt 更新作判据：真正的重新举起会带新的 raised_at，而消费后仍在路上的
      // 陈旧上报带的是同一个 raised_at，不会误把已消费的闸门复活成幽灵待批项。
      await prisma.harnessGate.update({
        where: { id: existing.id },
        data: {
          ...shape,
          // 上一轮的批准不得顺延到这一轮：新的举起要有新的人类决策
          decisionAction: null, decisionBy: null, decisionAt: null, decisionNote: null,
          decisionOnce: true, decisionSig: null, relayedAt: null, consumedAt: null
        }
      });
    } else {
      // 幂等：同一 gateId 只登记一次；已有决策的不覆盖（决策只由控制台写）
      await prisma.harnessGate.upsert({
        where: { harnessProjectId_gateId: { harnessProjectId: project.id, gateId: gate.id } },
        create: { userId: token.userId, harnessProjectId: project.id, gateId: gate.id, ...shape },
        update: { detail: gate.detail, evidence: (gate.evidence ?? []) as object }
      });
    }
  } else {
    // 机器侧已清空 pending_gate ⇒ 该项目所有已下发的闸门视为消费完毕。
    // 只标记已中继过的，避免把「还没送到机器」的闸门误标成已消费。
    await prisma.harnessGate.updateMany({
      where: { harnessProjectId: project.id, consumedAt: null, relayedAt: { not: null } },
      data: { consumedAt: now }
    });
  }

  return Response.json({ ok: true, harnessProjectId: project.id, linkedProjectId: linked?.id ?? null });
}

export async function GET(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();
  const repoKey = new URL(request.url).searchParams.get("repoKey");
  if (!repoKey) return forbidden("repoKey is required");
  const p = await prisma.harnessProject.findUnique({
    where: { deviceId_repoKey: { deviceId: token.deviceId, repoKey } }
  });
  return Response.json({ project: p });
}
