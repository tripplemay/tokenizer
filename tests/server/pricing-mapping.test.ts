import { describe, expect, it } from "vitest";
import { dashVersionToDot, toLiteLLMKeys, toOpenRouterId, vendorFamily } from "@/server/pricing/mapping";

describe("vendorFamily", () => {
  it("maps each family from the key prefix", () => {
    expect(vendorFamily("claude-opus-4-8")).toBe("anthropic");
    expect(vendorFamily("fable-5")).toBe("anthropic");
    expect(vendorFamily("gpt-5.5")).toBe("openai");
    expect(vendorFamily("gpt-5.3-codex")).toBe("openai");
    expect(vendorFamily("gemini-3.1-pro-preview")).toBe("google");
    expect(vendorFamily("deepseek-v4-pro")).toBe("deepseek");
    expect(vendorFamily("glm-5")).toBe("zhipu");
    expect(vendorFamily("kimi-for-coding")).toBe("moonshot");
    expect(vendorFamily("minimax-m2.5-free")).toBe("minimax");
    expect(vendorFamily("mimo-v2.5-pro")).toBe("xiaomi");
    expect(vendorFamily("totally-unknown")).toBe(null);
  });
});

describe("dashVersionToDot", () => {
  it("dots a trailing -N-N version, leaving dotted/word ids alone", () => {
    expect(dashVersionToDot("claude-opus-4-8")).toBe("claude-opus-4.8");
    expect(dashVersionToDot("claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(dashVersionToDot("gpt-5.5")).toBe("gpt-5.5");
    expect(dashVersionToDot("glm-4.7")).toBe("glm-4.7");
    expect(dashVersionToDot("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(dashVersionToDot("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
  });
});

describe("toOpenRouterId", () => {
  it("prefixes the provider slug and dots the version", () => {
    expect(toOpenRouterId("claude-opus-4-8")).toBe("anthropic/claude-opus-4.8");
    expect(toOpenRouterId("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4.6");
    expect(toOpenRouterId("gpt-5.5")).toBe("openai/gpt-5.5");
    expect(toOpenRouterId("gemini-3.1-pro-preview")).toBe("google/gemini-3.1-pro-preview");
    expect(toOpenRouterId("glm-5")).toBe("z-ai/glm-5");
    expect(toOpenRouterId("deepseek-v4-pro")).toBe("deepseek/deepseek-v4-pro");
  });

  it("maps a -free suffix to :free", () => {
    expect(toOpenRouterId("deepseek-v4-flash-free")).toBe("deepseek/deepseek-v4-flash:free");
    expect(toOpenRouterId("minimax-m2.5-free")).toBe("minimax/minimax-m2.5:free");
  });

  it("honours explicit aliases (null = known-unmappable)", () => {
    expect(toOpenRouterId("kimi-for-coding")).toBe(null);
    expect(toOpenRouterId("mimo-v2.5-pro")).toBe("xiaomi/mimo-v2.5");
  });

  it("returns null for an unknown vendor", () => {
    expect(toOpenRouterId("totally-unknown-model")).toBe(null);
  });
});

describe("toLiteLLMKeys", () => {
  it("uses the bare key (Anthropic/OpenAI/Gemini match verbatim)", () => {
    expect(toLiteLLMKeys("claude-opus-4-8")).toEqual(["claude-opus-4-8"]);
  });
});
