import { NextRequest } from "next/server";
import { requireSession } from "@/server/auth-session";
import { getQuotaLatest } from "@/server/quota";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const session = await requireSession();
  const data = await getQuotaLatest(session.user.id);
  return Response.json(data);
}
