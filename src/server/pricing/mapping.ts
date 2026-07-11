// Model-id mapping between the tokenizer's normalized keys (bare, dash-versioned,
// e.g. claude-opus-4-8) and each external price source. Pure + fully tested.

// Vendor family from a normalized model key. Drives cache-tier derivation and
// the OpenRouter provider slug.
export function vendorFamily(modelKey: string): string | null {
  if (/^(claude|fable)/.test(modelKey)) return "anthropic";
  if (/^gpt/.test(modelKey) || /codex/.test(modelKey) || /^o\d/.test(modelKey)) return "openai";
  if (/^gemini/.test(modelKey)) return "google";
  if (/^deepseek/.test(modelKey)) return "deepseek";
  if (/^glm/.test(modelKey)) return "zhipu";
  if (/^(kimi|moonshot)/.test(modelKey)) return "moonshot";
  if (/^minimax/.test(modelKey)) return "minimax";
  if (/^mimo/.test(modelKey)) return "xiaomi";
  return null;
}

// OpenRouter provider slug per vendor family (research: Zhipu -> z-ai,
// Moonshot -> moonshotai, MiMo -> xiaomi).
const OPENROUTER_SLUG: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  zhipu: "z-ai",
  moonshot: "moonshotai",
  minimax: "minimax",
  xiaomi: "xiaomi"
};

// Explicit overrides where the algorithm can't produce a correct id (research
// flagged these as falling through both structured sources). `null` means
// "known-unmappable" — skip straight to the human-approval fallback.
export const OPENROUTER_ALIASES: Record<string, string | null> = {
  "kimi-for-coding": null, // a Moonshot subscription plan, not an aggregator id
  "mimo-v2.5-pro": "xiaomi/mimo-v2.5" // OpenRouter carries the base tier, not -pro
};

// Convert a trailing "-<digits>-<digits>" to dotted form so dash-versioned
// Anthropic ids match OpenRouter's dotted ids:
//   claude-opus-4-8   -> claude-opus-4.8
//   claude-sonnet-4-6 -> claude-sonnet-4.6
// Already-dotted families (gpt-5.5, glm-4.7) are untouched.
export function dashVersionToDot(id: string): string {
  return id.replace(/-(\d+)-(\d+)(?=$|-)/g, "-$1.$2");
}

// Map a normalized key to an OpenRouter model id, or null when it can't be
// mapped (unknown vendor, or an explicit null alias).
export function toOpenRouterId(modelKey: string): string | null {
  if (Object.prototype.hasOwnProperty.call(OPENROUTER_ALIASES, modelKey)) {
    return OPENROUTER_ALIASES[modelKey];
  }
  const family = vendorFamily(modelKey);
  if (!family) return null;
  const slug = OPENROUTER_SLUG[family];
  if (!slug) return null;

  let id = modelKey;
  let freeSuffix = "";
  if (id.endsWith("-free")) {
    id = id.slice(0, -"-free".length);
    freeSuffix = ":free";
  }
  id = dashVersionToDot(id);
  return `${slug}/${id}${freeSuffix}`;
}

// LiteLLM keys US first-party models with the bare, dash-versioned id — i.e.
// identical to our normalized key. Return the candidate lookup key(s) in
// priority order; today the exact key is the only reliable match.
export function toLiteLLMKeys(modelKey: string): string[] {
  return [modelKey];
}
