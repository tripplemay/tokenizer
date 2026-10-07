import { revalidateTag } from "next/cache";
import { MODEL_PRICES_CACHE_TAG } from "@/shared/model-price";

export function invalidateModelPricesCache(): void {
  try {
    revalidateTag(MODEL_PRICES_CACHE_TAG);
  } catch (error) {
    // A committed price write must not be reported as failed; TTL bounds staleness.
    console.error("Failed to invalidate model-prices cache", error);
  }
}
