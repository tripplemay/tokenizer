import { prisma } from "../db";
import { MODEL_PRICES, normalizeModelKey } from "@/shared/model-pricing";
import { MODEL_PRICE_STATUS, isFreeConventionKey } from "@/shared/model-price";

export type DetectedModelRow = {
  modelKey: string;
  status: string;
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  source?: string;
  confidence?: string;
  notes?: string;
};

// Pure planner (mirrors src/server/cleanup.ts): given the raw model strings from
// a batch and the set of normalized keys that already have a ModelPrice row,
// return the new rows to insert. Skips models the static seed already prices and
// keys already tracked (in any status, so a rejected/pending model is not
// re-detected every batch). A trailing "-free" key auto-applies $0 by
// convention; everything else lands as `detected`, awaiting a lookup.
export function planModelPriceDetection(
  rawModels: Array<string | null | undefined>,
  existingKeys: Set<string>
): DetectedModelRow[] {
  const seen = new Set<string>();
  const out: DetectedModelRow[] = [];
  for (const raw of rawModels) {
    const key = normalizeModelKey(raw);
    if (!key) continue; // null / unknown model — tracked separately upstream
    if (seen.has(key)) continue; // dedupe within the batch
    seen.add(key);
    if (MODEL_PRICES[key]) continue; // already priced by the static seed
    if (existingKeys.has(key)) continue; // already tracked (detected/pending/rejected/...)
    if (isFreeConventionKey(key)) {
      out.push({
        modelKey: key,
        status: MODEL_PRICE_STATUS.autoApplied,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        source: "convention",
        confidence: "low",
        notes: "auto $0 via -free suffix convention"
      });
    } else {
      out.push({ modelKey: key, status: MODEL_PRICE_STATUS.detected });
    }
  }
  return out;
}

// Best-effort DB glue for the ingest path. NEVER throws into ingest — the caller
// wraps it, but we also keep the DB work minimal and race-safe (createMany with
// skipDuplicates handles two batches detecting the same new model at once).
// Returns the keys that still need a price lookup (status=detected) so the
// caller can decide whether to kick one off.
export async function detectAndTrackUnpricedModels(
  rawModels: Array<string | null | undefined>
): Promise<string[]> {
  // Pre-filter against the static seed so we only hit the DB for genuinely new
  // keys — the overwhelmingly common case is a batch of already-priced models.
  const candidateKeys = new Set<string>();
  for (const raw of rawModels) {
    const key = normalizeModelKey(raw);
    if (key && !MODEL_PRICES[key]) candidateKeys.add(key);
  }
  if (candidateKeys.size === 0) return [];

  const existing = await prisma.modelPrice.findMany({
    where: { modelKey: { in: [...candidateKeys] } },
    select: { modelKey: true }
  });
  const existingKeys = new Set(existing.map((row) => row.modelKey));

  const toCreate = planModelPriceDetection([...candidateKeys], existingKeys);
  if (toCreate.length === 0) return [];

  await prisma.modelPrice.createMany({ data: toCreate, skipDuplicates: true });
  return toCreate
    .filter((row) => row.status === MODEL_PRICE_STATUS.detected)
    .map((row) => row.modelKey);
}
