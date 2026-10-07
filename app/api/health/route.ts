import { readinessResponse } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return readinessResponse();
}
