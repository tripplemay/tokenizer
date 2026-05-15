import { getProjectSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ projects: await getProjectSummary() });
}
