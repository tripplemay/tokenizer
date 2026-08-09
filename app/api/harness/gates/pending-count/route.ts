import { auth } from "@/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

// BL-GATE-INBOX F001：全站待批徽章的轻量计数源。只读、会话鉴权、
// 与 /harness 列表页的收件箱聚合同一口径（未消费且未决策）。
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const pending = await prisma.harnessGate.count({
    where: { userId: session.user.id, consumedAt: null, decisionAction: null }
  });
  return Response.json({ pending });
}
