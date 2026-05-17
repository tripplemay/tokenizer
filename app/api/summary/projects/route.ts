import { auth } from "@/auth";
import { getProjectSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ projects: await getProjectSummary(session.user.id) });
}
