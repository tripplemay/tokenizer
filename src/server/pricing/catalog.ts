import { fetchJson } from "./fetch";

// Defaults point at the live community feeds. LITELLM_PRICES_URL can be pinned
// to a specific commit SHA raw URL for reproducibility (recommended for prod).
// Use || (not ??) so an empty-string env var (docker-compose passes "" when a
// var is unset) falls back to the default instead of becoming a broken URL.
const LITELLM_URL =
  process.env.LITELLM_PRICES_URL ||
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OPENROUTER_URL = process.env.OPENROUTER_MODELS_URL || "https://openrouter.ai/api/v1/models";

export function liteLLMUrl(): string {
  return LITELLM_URL;
}

export function openRouterUrl(): string {
  return OPENROUTER_URL;
}

// Both fetchers swallow errors and return null so a source being down degrades
// gracefully (the other source / the LLM fallback still runs).
export async function fetchLiteLLMCatalog(): Promise<Record<string, unknown> | null> {
  try {
    const data = await fetchJson(LITELLM_URL, { timeoutMs: 20000 });
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch (error) {
    console.error("litellm catalog fetch failed", error);
    return null;
  }
}

export async function fetchOpenRouterCatalog(): Promise<Array<{ id?: string; pricing?: Record<string, unknown> }> | null> {
  try {
    const data = await fetchJson(OPENROUTER_URL, { timeoutMs: 20000 });
    const models = (data as { data?: unknown } | null)?.data;
    return Array.isArray(models) ? (models as Array<{ id?: string; pricing?: Record<string, unknown> }>) : null;
  } catch (error) {
    console.error("openrouter catalog fetch failed", error);
    return null;
  }
}
