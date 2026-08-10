import { describe, expect, it } from "vitest";
import { safeCallbackPath, safeHttpUrl } from "@/shared/url";

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

describe("safeCallbackPath", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "%2F%2Fevil.example",
    "%5C%5Cevil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "http:/evil",
    "/\\/evil.example",
    "HTTPS://evil.example",
    "JavaScript:alert(1)",
    " https://evil.example",
    "https://evil.example ",
    "/%2F%2Fevil.example",
    "/%5C%5Cevil.example",
    "/%252F%252Fevil.example"
  ])("falls back for unsafe callback %j", (value) => {
    expect(safeCallbackPath(value)).toBe("/");
  });

  it.each(["/", "/models/abc", "/devices/x?a=1#h"])("preserves legal path %j", (value) => {
    expect(safeCallbackPath(value)).toBe(value);
  });

  it("rejects malformed encoding and controls rather than normalizing them", () => {
    expect(safeCallbackPath("/%" /* malformed percent escape */)).toBe("/");
    expect(safeCallbackPath("/devices/\nadmin")).toBe("/");
    expect(safeCallbackPath(null)).toBe("/");
    expect(safeCallbackPath(undefined)).toBe("/");
    expect(safeCallbackPath("")).toBe("/");
  });

  it("fails closed when deeply nested encoding has not completed decoding", () => {
    expect(safeCallbackPath(`/${"%25".repeat(17)}2F%2Fevil.example`)).toBe("/");
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
