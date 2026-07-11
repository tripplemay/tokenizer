import { prisma } from "../db";
import { normalizeModelKey } from "@/shared/model-pricing";
import { MODEL_PRICE_STATUS } from "@/shared/model-price";
import { safeHttpUrl } from "@/shared/url";

// Action-first ordering: rows a human must act on float to the top.
const STATUS_PRIORITY: Record<string, number> = {
  [MODEL_PRICE_STATUS.pendingReview]: 0,
  [MODEL_PRICE_STATUS.detected]: 1,
  [MODEL_PRICE_STATUS.failed]: 2,
  [MODEL_PRICE_STATUS.autoApplied]: 3,
  [MODEL_PRICE_STATUS.approved]: 4,
  [MODEL_PRICE_STATUS.ignored]: 5,
  [MODEL_PRICE_STATUS.rejected]: 6
};

export type PricingQueueRow = {
  id: string;
  modelKey: string;
  status: string;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  source: string | null;
  sourceUrl: string | null;
  confidence: string | null;
  notes: string | null;
  firstSeenAt: string;
  pricedAt: string | null;
  totalTokens: number;
  billableTokens: number;
};

function num(value: number | bigint | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

function dec(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The admin queue: every ModelPrice row joined to its GLOBAL (cross-tenant)
// token volume so the operator can prioritize by spend. Unlike every other
// model groupBy in the app, the volume query here is intentionally NOT
// tenant-scoped — pricing is a global concern and this is an admin-only view.
export async function getPricingQueue(): Promise<{ rows: PricingQueueRow[]; counts: Record<string, number> }> {
  const [rows, volumeRows] = await Promise.all([
    prisma.modelPrice.findMany(),
    prisma.usageEvent.groupBy({
      by: ["model"],
      _sum: { totalTokens: true, inputTokens: true, cachedInputTokens: true, outputTokens: true }
    })
  ]);

  // Aggregate raw model strings into normalized keys so a dated variant
  // (claude-x-20260101) and its base share one volume figure — matching how
  // detection keys the ModelPrice rows.
  const volumeByKey = new Map<string, { total: number; billable: number }>();
  for (const row of volumeRows) {
    const key = normalizeModelKey(row.model);
    if (!key) continue;
    const input = num(row._sum.inputTokens);
    const cached = num(row._sum.cachedInputTokens);
    const output = num(row._sum.outputTokens);
    const billable = Math.max(0, input - cached) + output;
    const cur = volumeByKey.get(key) ?? { total: 0, billable: 0 };
    cur.total += num(row._sum.totalTokens);
    cur.billable += billable;
    volumeByKey.set(key, cur);
  }

  const counts: Record<string, number> = {};
  const out: PricingQueueRow[] = rows.map((r) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const vol = volumeByKey.get(r.modelKey) ?? { total: 0, billable: 0 };
    return {
      id: r.id,
      modelKey: r.modelKey,
      status: r.status,
      input: dec(r.input),
      cacheRead: dec(r.cacheRead),
      cacheWrite: dec(r.cacheWrite),
      output: dec(r.output),
      source: r.source,
      // Defensive: sanitize any already-stored non-http(s) url so the admin
      // page never renders a javascript:/data: href.
      sourceUrl: safeHttpUrl(r.sourceUrl),
      confidence: r.confidence,
      notes: r.notes,
      firstSeenAt: r.firstSeenAt.toISOString(),
      pricedAt: r.pricedAt?.toISOString() ?? null,
      totalTokens: vol.total,
      billableTokens: vol.billable
    };
  });

  out.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 9;
    const pb = STATUS_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.billableTokens - a.billableTokens;
  });

  return { rows: out, counts };
}
