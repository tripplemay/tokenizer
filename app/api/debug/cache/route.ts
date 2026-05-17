import { NextRequest } from "next/server";
import { getSummary, getDailySummary, getProjectSummary, getDeviceSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

// Quick timing probe to distinguish "unstable_cache misses" from "cache hits
// but slow lookup". Hits the same summary functions back-to-back from the
// same request and reports per-call latency.
export async function GET(_request: NextRequest) {
  const samples: Record<string, number[]> = {};
  for (const [name, call] of Object.entries({
    getSummary: () => getSummary("all"),
    getDailySummary: () => getDailySummary("all"),
    getProjectSummary: () => getProjectSummary("all", "all"),
    getDeviceSummary: () => getDeviceSummary("all")
  }) as Array<[string, () => Promise<unknown>]>) {
    samples[name] = [];
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      await call();
      samples[name].push(Date.now() - start);
    }
  }
  return Response.json({ samples, note: "all 'all' range — 1st may be cold, 2nd/3rd should hit cache" });
}
