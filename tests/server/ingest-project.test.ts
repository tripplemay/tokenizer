import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { DeviceInput, UsageEventInput } from "@/shared/usage";

const prismaMock = vi.hoisted(() => ({
  device: { upsert: vi.fn() },
  deviceToken: { update: vi.fn() },
  project: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  usageEvent: { createMany: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { ingestUsageEvents } from "@/server/ingest";

function uniqueConstraintError(fields: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: fields }
  });
}

function event(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    source: "claude-code",
    sourceEventId: "evt-1",
    occurredAt: "2026-07-02T00:00:00.000Z",
    inputTokens: 10,
    outputTokens: 5,
    ...overrides
  };
}

const device: DeviceInput = { id: "dev-1", name: "Test Device" };

describe("ingestUsageEvents project resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.device.upsert.mockResolvedValue({ id: device.id });
    prismaMock.deviceToken.update.mockResolvedValue({});
    prismaMock.usageEvent.createMany.mockImplementation(({ data }: { data: unknown[] }) =>
      Promise.resolve({ count: data.length })
    );
  });

  it("links events to the upserted project on the happy path", async () => {
    prismaMock.project.upsert.mockResolvedValue({ id: "proj-1" });

    const result = await ingestUsageEvents(
      [event({ repoKey: "github.com/acme/app", workspacePath: "/Users/a/app" })],
      device,
      "tok-1",
      "user-1"
    );

    expect(result.inserted).toBe(1);
    const rows = prismaMock.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows[0].projectId).toBe("proj-1");
  });

  it("adopts the existing repoKey-less row when a non-git project gains a git remote", async () => {
    prismaMock.project.upsert.mockRejectedValue(uniqueConstraintError(["workspacePath"]));
    prismaMock.project.findUnique.mockResolvedValue({ id: "proj-legacy" });
    prismaMock.project.update.mockResolvedValue({ id: "proj-legacy" });

    const result = await ingestUsageEvents(
      [
        event({
          repoKey: "github.com/tripplemay/grandtianfu",
          gitRemote: "https://github.com/tripplemay/grandtianfu.git",
          workspacePath: "/Users/yixingzhou/project/grandtianfu"
        })
      ],
      device,
      "tok-1",
      "user-1"
    );

    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: {
        userId_workspacePath: { userId: "user-1", workspacePath: "/Users/yixingzhou/project/grandtianfu" }
      }
    });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: "proj-legacy" },
      data: {
        name: "grandtianfu",
        repoKey: "github.com/tripplemay/grandtianfu",
        repoRemote: "https://github.com/tripplemay/grandtianfu.git"
      }
    });
    expect(result.inserted).toBe(1);
    const rows = prismaMock.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows[0].projectId).toBe("proj-legacy");
  });

  it("still ingests the batch without a project link when project resolution fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.project.upsert.mockRejectedValue(uniqueConstraintError(["workspacePath"]));
    prismaMock.project.findUnique.mockResolvedValue(null);

    const result = await ingestUsageEvents(
      [
        event({ sourceEventId: "evt-1", repoKey: "github.com/acme/app", workspacePath: "/Users/a/app" }),
        event({ sourceEventId: "evt-2", repoKey: "github.com/acme/app", workspacePath: "/Users/a/app" })
      ],
      device,
      "tok-1",
      "user-1"
    );

    expect(result.inserted).toBe(2);
    expect(result.received).toBe(2);
    const rows = prismaMock.usageEvent.createMany.mock.calls[0][0].data;
    expect(rows.every((row: { projectId: string | null }) => row.projectId === null)).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not attempt adoption for non-unique-constraint errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.project.upsert.mockRejectedValue(new Error("connection lost"));

    await ingestUsageEvents(
      [event({ repoKey: "github.com/acme/app", workspacePath: "/Users/a/app" })],
      device,
      "tok-1",
      "user-1"
    );

    expect(prismaMock.project.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.project.update).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
