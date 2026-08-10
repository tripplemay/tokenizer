import type { DeviceInput, UsageEventInput, UsageSource } from "./usage";

// These are display/transport bounds, not database limits. The hot paths
// clean values to these bounds so one malformed event cannot pin an agent's
// queue forever.
export const MAX_DEVICE_NAME_LENGTH = 200;
export const MAX_SOURCE_LENGTH = 100;

const CONTROL_CHARACTERS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARACTERS_RE, "");
}

export function sanitizeBoundedString(value: string, maxLength: number): string {
  return stripControlCharacters(value).slice(0, maxLength);
}

export function isValidDeviceName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DEVICE_NAME_LENGTH &&
    stripControlCharacters(value) === value
  );
}

export function sanitizeDeviceForIngest(device: DeviceInput): DeviceInput {
  const name = typeof device.name === "string" ? sanitizeBoundedString(device.name, MAX_DEVICE_NAME_LENGTH) : "";
  return { ...device, name: name || device.id };
}

export function sanitizeUsageEventForIngest(event: UsageEventInput): UsageEventInput {
  const source = typeof event.source === "string" ? sanitizeBoundedString(event.source, MAX_SOURCE_LENGTH) : "";
  return { ...event, source: source as UsageSource };
}
