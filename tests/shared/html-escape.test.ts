import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/shared/html-escape";

describe("escapeHtml", () => {
  it("escapes every HTML-significant delimiter used by tooltip templates", () => {
    expect(escapeHtml(`<img src=x onerror='alert("x")' data-tick=\`x\`>&`)).toBe(
      "&lt;img src=x onerror=&#39;alert(&quot;x&quot;)&#39; data-tick=&#96;x&#96;&gt;&amp;"
    );
  });

  it("leaves ordinary tooltip text unchanged", () => {
    expect(escapeHtml("2026-08-10 · $1.25")).toBe("2026-08-10 · $1.25");
  });
});
