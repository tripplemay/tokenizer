import { postJson } from "./fetch";
import { safeHttpUrl } from "@/shared/url";

// A candidate price the LLM claims is the official list price (USD per 1M
// tokens). ALWAYS lands as pending_review — the LLM is a suggestion engine, not
// an authority, so a human confirms it against sourceUrl before it bills.
export type LLMPriceCandidate = {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  sourceUrl: string | null;
  raw: unknown;
};

// Optional, pluggable, OpenAI-compatible chat endpoint (e.g. the AIGC gateway).
// Returns null when not configured — the fallback simply doesn't run and the
// model stays queued for manual pricing.
export async function lookupPriceViaLLM(modelKey: string): Promise<LLMPriceCandidate | null> {
  const base = process.env.PRICING_LLM_BASE_URL;
  const apiKey = process.env.PRICING_LLM_KEY;
  const model = process.env.PRICING_LLM_MODEL;
  if (!base || !apiKey || !model) return null;

  const prompt = `You are a precise pricing lookup for LLM API models. For the model id "${modelKey}", return the vendor's OFFICIAL published list price in USD per 1,000,000 tokens as strict JSON with this exact shape:
{"found": boolean, "input": number, "output": number, "cacheRead": number|null, "cacheWrite": number|null, "sourceUrl": string}
Rules: set found=true only if you are confident of the official price; put the official pricing-page URL in sourceUrl; use null for a cache tier the vendor does not offer; if you are unsure, return {"found": false}. Output JSON only, no prose.`;

  try {
    const res = await postJson(
      `${base.replace(/\/$/, "")}/chat/completions`,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" }
      },
      { headers: { authorization: `Bearer ${apiKey}` }, timeoutMs: 30000 }
    );

    const content = (res as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(content) as {
      found?: boolean;
      input?: unknown;
      output?: unknown;
      cacheRead?: unknown;
      cacheWrite?: unknown;
      sourceUrl?: unknown;
    };
    if (!parsed.found) return null;

    const input = Number(parsed.input);
    const output = Number(parsed.output);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;

    const readNumOrNull = (value: unknown): number | null => {
      if (value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    return {
      input,
      output,
      cacheRead: readNumOrNull(parsed.cacheRead),
      cacheWrite: readNumOrNull(parsed.cacheWrite),
      // Only keep an http(s) url — never let a javascript:/data: url the model
      // emitted reach the DB and later an admin's <a href>.
      sourceUrl: safeHttpUrl(typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : null),
      raw: parsed
    };
  } catch (error) {
    console.error(`llm price fallback failed for ${modelKey}`, error);
    return null;
  }
}
