import { isAbsolute, win32 } from "node:path";

export type BoundedReplayPlan = Readonly<{
  source: "claude-code";
  file: string;
  from: string;
  to: string;
  maxBytes: number;
  maxEvents: number;
  maxFiles: 1;
  dryRun: true;
}>;

// Contract validation only. No parser adapter, file I/O, or executable CLI is
// provided in this slice; R07 must enforce these budgets while reading.
export function planBoundedReplay(input: unknown): BoundedReplayPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Replay requires an explicit bounded request");
  const request = input as Record<string, unknown>;
  const keys = new Set(["source", "file", "from", "to", "maxBytes", "maxEvents", "dryRun"]);
  if (Object.keys(request).some((key) => !keys.has(key))) throw new Error("Unknown replay scope or option");
  if (request.source !== "claude-code") throw new Error("Replay source has no explicit-file adapter contract");
  if (typeof request.file !== "string" || (!isAbsolute(request.file) && !win32.isAbsolute(request.file)) ||
      /[*?\[\]]/.test(request.file) || request.file.includes("\0") || !request.file.endsWith(".jsonl")) {
    throw new Error("Replay requires one absolute literal .jsonl file, never a directory or glob");
  }
  const utc = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  };
  if (!utc(request.from) || !utc(request.to) || Date.parse(request.to) <= Date.parse(request.from) ||
      Date.parse(request.to) - Date.parse(request.from) > 31 * 86_400_000) {
    throw new Error("Replay requires explicit canonical UTC [from,to) within 31 days");
  }
  const limit = (value: unknown, maximum: number): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
  if (!limit(request.maxBytes, 16 * 1024 * 1024) || !limit(request.maxEvents, 5_000)) {
    throw new Error("Replay requires byte/event limits within 16 MiB and 5000 events");
  }
  if (request.dryRun !== undefined && request.dryRun !== true) {
    throw new Error("Replay execution is not implemented; only a non-executing plan is available");
  }
  return Object.freeze({
    source: request.source,
    file: request.file,
    from: request.from,
    to: request.to,
    maxBytes: request.maxBytes,
    maxEvents: request.maxEvents,
    maxFiles: 1,
    dryRun: true
  });
}
