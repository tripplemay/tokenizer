import { describe, expect, it } from "vitest";
import { isValidIanaTimezone, resolveTimezone } from "@/server/timezone";

describe("isValidIanaTimezone", () => {
  it("accepts well-known IANA names", () => {
    expect(isValidIanaTimezone("Asia/Shanghai")).toBe(true);
    expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidIanaTimezone("Europe/London")).toBe(true);
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it("rejects empty / nullish / non-string", () => {
    expect(isValidIanaTimezone("")).toBe(false);
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(undefined)).toBe(false);
    expect(isValidIanaTimezone(123)).toBe(false);
    expect(isValidIanaTimezone({})).toBe(false);
  });

  it("rejects overlong strings (potential injection vector)", () => {
    expect(isValidIanaTimezone("a".repeat(65))).toBe(false);
    expect(isValidIanaTimezone("a".repeat(64))).toBe(false);  // exactly the limit still rejected because not a real tz
  });

  it("rejects invalid IANA names", () => {
    expect(isValidIanaTimezone("Foo/Bar")).toBe(false);
    expect(isValidIanaTimezone("Not_A_Real_Zone")).toBe(false);
    expect(isValidIanaTimezone("'; DROP TABLE \"User\"; --")).toBe(false);
  });
});

describe("resolveTimezone", () => {
  it("returns Asia/Shanghai fallback for null/undefined/empty", () => {
    expect(resolveTimezone(null)).toBe("Asia/Shanghai");
    expect(resolveTimezone(undefined)).toBe("Asia/Shanghai");
    expect(resolveTimezone("")).toBe("Asia/Shanghai");
  });

  it("passes through any non-empty value (validation is a separate concern)", () => {
    expect(resolveTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveTimezone("UTC")).toBe("UTC");
  });
});
