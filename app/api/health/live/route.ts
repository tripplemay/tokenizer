import { deployedCommit } from "@/server/health-core";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, code: "alive", commit: deployedCommit() });
}
