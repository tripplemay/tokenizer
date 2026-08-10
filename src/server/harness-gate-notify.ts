import { prisma } from "@/server/db";

// BL-GATE-INBOX F002：闸门邮件通知。铁则 fail-open——通知是旁路不是闸门：
// key 未配 / 收件人为空 / 发送失败一律静默收场，绝不影响 report 通道的 200。
// 恰一次语义靠 notifiedAt 的 claim 式 updateMany（原子计数 1 才发送）；
// 发送失败复位 null 由下一轮 report 自然重试；re-raise 在 report 路由复位。

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type GateEmailInput = {
  projectName: string;
  repoKey: string;
  kind: string;
  batch: string;
  fromStatus: string | null;
  toStatus: string | null;
  detail: string;
  raisedAt: Date;
  consoleUrl: string;
};

/** 纯函数：邮件主题与正文（时间恒 UTC ISO——测试快照钉住） */
export function renderGateEmail(input: GateEmailInput): { subject: string; text: string } {
  const transition =
    input.fromStatus || input.toStatus ? `${input.fromStatus ?? "?"} → ${input.toStatus ?? "?"}` : null;
  const subject = `[tokenizer] 待批闸门：${input.projectName} · ${input.kind}${input.batch ? ` · ${input.batch}` : ""}`;
  const lines = [
    `项目：${input.projectName}（${input.repoKey}）`,
    `类型：${input.kind}`,
    input.batch ? `批次：${input.batch}` : null,
    transition ? `流转：${transition}` : null,
    `举起时间：${input.raisedAt.toISOString()}`,
    "",
    input.detail,
    "",
    `前往批准：${input.consoleUrl}`
  ].filter((line): line is string => line !== null);
  return { subject, text: lines.join("\n") };
}

/** 从环境与请求推导控制台链接（NEXT_PUBLIC_APP_URL 优先，回落 request origin） */
export function consoleUrlFrom(requestOrigin: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || requestOrigin;
  return `${base.replace(/\/+$/, "")}/harness`;
}

/**
 * 对一个 harness 项目当前未通知的闸门尝试发送通知。
 * 任何失败路径都吞掉并复位 claim；永不 throw。
 */
export async function notifyPendingGate(scope: {
  userId: string;
  harnessProjectId: string;
  gateId: string;
  requestOrigin: string;
}): Promise<void> {
  try {
    const apiKey = process.env.AUTH_RESEND_KEY;
    if (!apiKey) return;

    const gate = await prisma.harnessGate.findFirst({
      where: {
        userId: scope.userId,
        harnessProjectId: scope.harnessProjectId,
        gateId: scope.gateId,
        notifiedAt: null,
        consumedAt: null,
        decisionAction: null
      },
      select: {
        id: true,
        kind: true,
        batch: true,
        fromStatus: true,
        toStatus: true,
        detail: true,
        raisedAt: true,
        harnessProject: { select: { name: true, repoKey: true } },
        user: { select: { email: true } }
      }
    });
    if (!gate || !gate.user.email) return;

    // claim：原子标记，计数不为 1 说明并发上报已抢先，安静退出
    const claimed = await prisma.harnessGate.updateMany({
      where: { id: gate.id, notifiedAt: null },
      data: { notifiedAt: new Date() }
    });
    if (claimed.count !== 1) return;

    const { subject, text } = renderGateEmail({
      projectName: gate.harnessProject.name,
      repoKey: gate.harnessProject.repoKey,
      kind: gate.kind,
      batch: gate.batch,
      fromStatus: gate.fromStatus,
      toStatus: gate.toStatus,
      detail: gate.detail,
      raisedAt: gate.raisedAt,
      consoleUrl: consoleUrlFrom(scope.requestOrigin)
    });

    const from = process.env.AUTH_EMAIL_FROM ?? "no-reply@token.vpanel.cc";
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [gate.user.email], subject, text }),
      // Resend 正常响应 <1s；8s 只拦连接挂起，防止 undici 默认超时拖慢
      // 整个 report 响应。超时抛 TimeoutError 走下方 catch 复位 claim 重试。
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`resend ${response.status}`);
  } catch {
    // 发送失败复位 claim，下一轮 report 自然重试；复位自身失败也吞掉（fail-open 到底）
    try {
      await prisma.harnessGate.updateMany({
        where: {
          userId: scope.userId,
          harnessProjectId: scope.harnessProjectId,
          gateId: scope.gateId,
          consumedAt: null,
          decisionAction: null
        },
        data: { notifiedAt: null }
      });
    } catch {
      /* fail-open */
    }
  }
}
