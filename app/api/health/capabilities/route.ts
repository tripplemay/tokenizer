import { deployedCommit, healthCapabilities } from "@/server/health-core";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, commit: deployedCommit(), capabilities: healthCapabilities() });
}
