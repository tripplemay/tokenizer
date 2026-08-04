import { NextRequest } from "next/server";
import { authenticateDeviceToken, unauthorized } from "@/server/auth";
import { withHarnessRelayIdentity, parseHarnessRelayAgentIdentity } from "@/server/harness-relay-identity";
import { HarnessApiInputError, harnessInputErrorResponse } from "@/server/harness-mode-intent-api";

export const dynamic = "force-dynamic";

/**
 * device agent 拉取**已签名**的闸门决策，写回本机仓库的 progress.json。
 *
 * 安全模型：决策带 Ed25519 签名，机器侧用仓库里的 `.claude/console/console.pub` 验签
 * （`validate-pending-gate.sh guard`）。中继者（agent）与写代码的 agent 都伪造不了签名，
 * 所以「本地写入」是安全的——这正是不需要给控制台任何 git 写权限的原因。
 *
 * 未签名的决策**不下发**：宁可卡住，也不让机器拿到一条无法验证来源的批准。
 */

export async function GET(request: NextRequest) {
  const token = await authenticateDeviceToken(request);
  if (!token) return unauthorized();

  let identity;
  try {
    identity = parseHarnessRelayAgentIdentity(request);
  } catch (error) {
    if (error instanceof HarnessApiInputError) return harnessInputErrorResponse(error);
    throw error;
  }

  try {
    const result = await withHarnessRelayIdentity(token, identity, async ({ tx, now }) => {
      const gates = await tx.harnessGate.findMany({
        where: {
          userId: token.userId,
          harnessProject: { deviceId: token.deviceId, userId: token.userId },
          decisionSig: { not: null },     // 只下发已签名的
          consumedAt: null
        },
        include: { harnessProject: { select: { repoKey: true } } },
        orderBy: { decisionAt: "asc" },
        take: 50
      });

      const decisions = gates.map((g) => ({
        repoKey: g.harnessProject.repoKey,
        gate_id: g.gateId,
        // 字段名与 progress.json 的 pending_gate.decision 一致，agent 原样写入即可
        decision: {
          gate_id: g.gateId,
          action: g.decisionAction,
          by: g.decisionBy,
          at: g.decisionAt?.toISOString(),
          ...(g.decisionNote ? { note: g.decisionNote } : {}),
          scope: { once: g.decisionOnce },
          sig: g.decisionSig
        }
      }));

      // 标记已中继。仍不设 consumedAt——那要等机器侧真正写入并清空 pending_gate 后由 report 端点回收。
      if (gates.length > 0) {
        await tx.harnessGate.updateMany({
          where: { id: { in: gates.map((g) => g.id) }, userId: token.userId, relayedAt: null },
          data: { relayedAt: now }
        });
      }

      return { decisions };
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof HarnessApiInputError) return harnessInputErrorResponse(error);
    throw error;
  }
}
