import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@/shared/usage";

const fixture = vi.hoisted(() => {
  const tmp = (process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").replace(/[\\/]+$/, "");
  return {
    queuePath: `${tmp}/b07-versioned-quarantine-queue-${process.pid}.jsonl`,
    rejectedUsagePath: `${tmp}/b07-versioned-quarantine-rejected-${process.pid}.jsonl`
  };
});

vi.mock("@/cli/config", () => fixture);

import * as atomicFile from "@/cli/atomic-file";
import { queueEventVersion, readQueue, resolveQueueEvents, writeQueue } from "@/cli/queue";
import { quarantineUsageEvents, readRejectedUsageEvents } from "@/cli/rejected-events";

function event(inputTokens: number): UsageEventInput {
  return {
    source: "aider",
    sourceEventId: "same-id",
    occurredAt: "2026-10-08T00:00:00.000Z",
    inputTokens
  };
}

function versions(): string[] {
  return readRejectedUsageEvents().map((row) => queueEventVersion(row.event));
}

describe("B07 rejected exact-version durability", () => {
  beforeEach(() => {
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath]) rmSync(path, { force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const path of [fixture.queuePath, fixture.rejectedUsagePath]) {
      rmSync(path, { force: true });
      rmSync(`${path}.lock`, { force: true });
    }
  });

  it("keeps a later rejected correction after an older version was quarantined", () => {
    const old = event(1);
    const correction = event(200);
    quarantineUsageEvents([{ event: old, code: "invalid_event" }]);
    writeQueue([correction]);

    resolveQueueEvents({ accepted: [], rejected: [{ event: correction, code: "invalid_event" }] });

    expect(readQueue()).toEqual([]);
    expect(versions()).toEqual([queueEventVersion(old), queueEventVersion(correction)]);
  });

  it("keeps both rejected versions in one resolution and dedupes an identical retry", () => {
    const old = event(1);
    const correction = event(200);
    writeQueue([old, correction]);
    resolveQueueEvents({
      accepted: [],
      rejected: [
        { event: old, code: "invalid_event" },
        { event: correction, code: "invalid_event" }
      ]
    });
    quarantineUsageEvents([{ event: old, code: "invalid_event" }]);

    expect(readQueue()).toEqual([]);
    expect(versions()).toEqual([queueEventVersion(old), queueEventVersion(correction)]);
  });

  it("preserves both versions across a quarantine-then-queue-write fault and retry", () => {
    const old = event(1);
    const correction = event(200);
    writeQueue([old, correction]);
    const writeFileAtomic = atomicFile.writeFileAtomic;
    const fault = vi.spyOn(atomicFile, "writeFileAtomic").mockImplementation((path, content, options) => {
      if (path === fixture.queuePath) throw new Error("synthetic queue write fault");
      writeFileAtomic(path, content, options);
    });

    expect(() => resolveQueueEvents({ accepted: [], rejected: [{ event: old, code: "invalid_event" }] }))
      .toThrow("synthetic queue write fault");
    expect(readQueue().map(queueEventVersion)).toEqual([queueEventVersion(old), queueEventVersion(correction)]);
    expect(versions()).toEqual([queueEventVersion(old)]);

    fault.mockRestore();
    resolveQueueEvents({ accepted: [], rejected: [{ event: old, code: "invalid_event" }] });
    resolveQueueEvents({ accepted: [], rejected: [{ event: correction, code: "invalid_event" }] });
    expect(readQueue()).toEqual([]);
    expect(versions()).toEqual([queueEventVersion(old), queueEventVersion(correction)]);
  });
});
