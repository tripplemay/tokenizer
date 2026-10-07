import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  const root = `${tmp}/b07-private-${process.pid}`;
  return { root, queuePath: `${root}/state/queue.jsonl`, rejectedUsagePath: `${root}/state/rejected-usage.jsonl` };
});

vi.mock("@/cli/config", () => ({
  queuePath: fixture.queuePath,
  rejectedUsagePath: fixture.rejectedUsagePath
}));

import { readQueue, writeQueue } from "@/cli/collect";
import { quarantineUsageEvents } from "@/cli/rejected-events";

const active: UsageEventInput = {
  source: "aider", sourceEventId: "private", occurredAt: "2026-10-08T00:00:00.000Z",
  inputTokens: 1, workspacePath: "/private/workspace"
};
const mode = (path: string) => statSync(path).mode & 0o777;

describe("B07 private durable queue files", () => {
  let previousUmask: number;
  beforeEach(() => {
    rmSync(fixture.root, { recursive: true, force: true });
    previousUmask = process.umask(0o022);
  });
  afterEach(() => {
    process.umask(previousUmask);
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("creates and atomically replaces queue and quarantine as owner-only", () => {
    writeQueue([active]);
    quarantineUsageEvents([{ event: active, code: "invalid_event" }]);

    expect(readFileSync(fixture.rejectedUsagePath, "utf8")).toContain("/private/workspace");
    if (process.platform !== "win32") {
      expect(mode(dirname(fixture.queuePath))).toBe(0o700);
      expect(mode(fixture.queuePath)).toBe(0o600);
      expect(mode(fixture.rejectedUsagePath)).toBe(0o600);
    }

    chmodSync(fixture.queuePath, 0o644);
    chmodSync(fixture.rejectedUsagePath, 0o644);
    writeQueue([{ ...active, sourceEventId: "second" }]);
    quarantineUsageEvents([{ event: { ...active, sourceEventId: "second" }, code: "invalid_event" }]);
    if (process.platform !== "win32") {
      expect(mode(fixture.queuePath)).toBe(0o600);
      expect(mode(fixture.rejectedUsagePath)).toBe(0o600);
    }
    expect(readdirSync(dirname(fixture.queuePath)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("does not silently chmod a canonical legacy queue on read but tightens its next mutation", () => {
    mkdirSync(dirname(fixture.queuePath), { recursive: true });
    writeQueue([active]);
    chmodSync(fixture.queuePath, 0o644);
    expect(readQueue().map((row) => row.sourceEventId)).toEqual(["private"]);
    if (process.platform !== "win32") expect(mode(fixture.queuePath)).toBe(0o644);

    writeQueue([{ ...active, sourceEventId: "next" }]);
    if (process.platform !== "win32") expect(mode(fixture.queuePath)).toBe(0o600);
  });
});
