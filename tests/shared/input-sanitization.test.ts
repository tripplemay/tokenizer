import { describe, expect, it } from "vitest";
import {
  isValidDeviceName,
  MAX_DEVICE_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  sanitizeBoundedString,
  sanitizeDeviceForIngest,
  sanitizeUsageEventForIngest
} from "@/shared/input-sanitization";

describe("input sanitization", () => {
  it("removes controls before applying the display bound", () => {
    expect(sanitizeBoundedString(`ab\u0000\u001fcd${"x".repeat(300)}`, 4)).toBe("abcd");
  });

  it("hard-validates enrollment names at the boundary", () => {
    expect(isValidDeviceName("Desk agent")).toBe(true);
    expect(isValidDeviceName("Desk\u0000agent")).toBe(false);
    expect(isValidDeviceName("x".repeat(MAX_DEVICE_NAME_LENGTH + 1))).toBe(false);
  });

  it("cleans device and unknown source values without applying an enum", () => {
    const device = sanitizeDeviceForIngest({ id: "dev-1", name: `Desk\u0000${"x".repeat(300)}` });
    const event = sanitizeUsageEventForIngest({
      source: `kimicode\u0001${"x".repeat(200)}` as never,
      sourceEventId: "evt-1",
      occurredAt: "2026-08-10T00:00:00.000Z"
    });

    expect(device.name).toBe(`Desk${"x".repeat(MAX_DEVICE_NAME_LENGTH - 4)}`);
    expect(event.source).toBe(`kimicode${"x".repeat(MAX_SOURCE_LENGTH - 8)}`);
  });
});
