import { auth } from "@/auth";
import { getDeviceSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ devices: await getDeviceSummary(session.user.id) });
}
