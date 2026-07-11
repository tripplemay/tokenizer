import { after } from "next/server";
import { runPriceLookups } from "./lookup";

// Master switch for the auto-lookup pipeline. Detection (enqueuing) runs
// regardless; only the outbound price lookups are gated so the feature can ship
// dark and be enabled once the sources are validated against production.
export function isAutoPricingEnabled(): boolean {
  const value = process.env.PRICING_AUTO_ENABLED;
  return value === "1" || value === "true";
}

// Schedule an out-of-band price lookup for the given detected keys AFTER the
// current response is sent (Next 15 `after()`), so external HTTP never blocks
// the client's upload or the admin's scan request — the tension inherent in the
// "event-driven at ingest" trigger. No-op unless auto-pricing is enabled. Never
// throws into the caller; failures are logged and left as `failed` rows for the
// next scan to retry.
export async function maybeTriggerPriceLookup(detectedKeys: string[]): Promise<void> {
  if (!isAutoPricingEnabled() || detectedKeys.length === 0) return;
  after(async () => {
    try {
      await runPriceLookups(detectedKeys);
    } catch (error) {
      console.error("price lookup trigger failed", error);
    }
  });
}
