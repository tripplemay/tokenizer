import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "@/shared/url";

describe("safeHttpUrl", () => {
  it("passes through http and https urls", () => {
    expect(safeHttpUrl("https://openrouter.ai/anthropic/claude-opus-4.8")).toBe("https://openrouter.ai/anthropic/claude-opus-4.8");
    expect(safeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("rejects dangerous schemes and garbage", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBe(null);
    expect(safeHttpUrl("JavaScript:alert(1)")).toBe(null);
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(null);
    expect(safeHttpUrl("not a url")).toBe(null);
    expect(safeHttpUrl(null)).toBe(null);
    expect(safeHttpUrl(undefined)).toBe(null);
    expect(safeHttpUrl("")).toBe(null);
  });
});

// BL-GATE-INBOX F004：dashboardUrl 渲染防线场景（javascript:/data: 拒渲染）
import { safeHttpUrl as guardForDashboard } from "../../src/shared/url";

describe("dashboardUrl rendering guard", () => {
  it("refuses non-http(s) dashboard URLs before they can become hrefs", () => {
    expect(guardForDashboard("javascript:alert(1)")).toBeNull();
    expect(guardForDashboard("data:text/html,x")).toBeNull();
    expect(guardForDashboard("https://claude.ai/code/artifact/abc")).toBe("https://claude.ai/code/artifact/abc");
  });
});
