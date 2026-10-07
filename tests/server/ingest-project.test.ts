import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { DeviceInput, UsageEventInput } from "@/shared/usage";
import { projectNameFromPath } from "@/server/ingest";

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

  it("scrubs legacy Git credentials before project lookup and event persistence", async () => {
    prismaMock.project.upsert.mockResolvedValue({ id: "proj-safe" });

    await ingestUsageEvents(
      [event({
        repoKey: "reader:FAKE_TOKEN@git.example/old/repo",
        gitRemote: "https://reader:FAKE_TOKEN@git.example/Team/Repo.git?key=FAKE_QUERY#FAKE_FRAGMENT",
        workspacePath: "/work/repo"
      })],
      device,
      "tok-1",
      "user-1"
    );

    const projectCall = prismaMock.project.upsert.mock.calls[0][0];
    const row = prismaMock.usageEvent.createMany.mock.calls[0][0].data[0];
    expect(projectCall).toMatchObject({
      where: { userId_repoKey: { userId: "user-1", repoKey: "git.example/Team/Repo" } },
      create: { userId: "user-1", repoKey: "git.example/Team/Repo", repoRemote: "https://git.example/Team/Repo.git" },
      update: { repoRemote: "https://git.example/Team/Repo.git" }
    });
    expect(row).toMatchObject({ repoKey: "git.example/Team/Repo", gitRemote: "https://git.example/Team/Repo.git" });
    expect(JSON.stringify({ projectCall, row })).not.toMatch(/FAKE_TOKEN|FAKE_QUERY|FAKE_FRAGMENT/);
  });

  it("retains the user boundary when two users report the same repo with different credentials", async () => {
    prismaMock.project.upsert.mockResolvedValueOnce({ id: "proj-user-1" }).mockResolvedValueOnce({ id: "proj-user-2" });

    for (const [userId, token] of [["user-1", "FAKE_TOKEN_A"], ["user-2", "FAKE_TOKEN_B"]]) {
      await ingestUsageEvents(
        [event({ gitRemote: `https://reader:${token}@git.example/Team/Repo.git`, workspacePath: "/work/repo" })],
        device,
        "tok-1",
        userId
      );
    }

    const calls = prismaMock.project.upsert.mock.calls.map(([args]) => args);
    expect(calls.map((call) => call.where.userId_repoKey)).toEqual([
      { userId: "user-1", repoKey: "git.example/Team/Repo" },
      { userId: "user-2", repoKey: "git.example/Team/Repo" }
    ]);
    expect(calls.map((call) => call.create.userId)).toEqual(["user-1", "user-2"]);
    expect(prismaMock.usageEvent.createMany.mock.calls.map(([args]) => args.data[0].projectId)).toEqual([
      "proj-user-1", "proj-user-2"
    ]);
  });

  it("drops unsupported remotes and does not persist untrusted repo identity", async () => {
    prismaMock.project.upsert.mockResolvedValue({ id: "proj-local" });

    await ingestUsageEvents(
      [event({
        repoKey: "ftp://reader:FAKE_TOKEN@git.example/Team/Repo.git",
        gitRemote: "file:///private/FAKE_TOKEN/Repo.git",
        workspacePath: "/work/repo"
      })],
      device,
      "tok-1",
      "user-1"
    );

    expect(prismaMock.project.upsert.mock.calls[0][0].where).toEqual({
      userId_workspacePath: { userId: "user-1", workspacePath: "/work/repo" }
    });
    const row = prismaMock.usageEvent.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ repoKey: null, gitRemote: null, projectId: "proj-local" });
    expect(JSON.stringify(row)).not.toContain("FAKE_TOKEN");
  });

  it("canonicalizes a standalone repoKey with a non-default port", async () => {
    prismaMock.project.upsert.mockResolvedValue({ id: "proj-port" });

    await ingestUsageEvents(
      [event({ repoKey: "git.example:8443/Team/Repo", workspacePath: "/work/repo" })],
      device,
      "tok-1",
      "user-1"
    );

    expect(prismaMock.project.upsert.mock.calls[0][0].where).toEqual({
      userId_repoKey: { userId: "user-1", repoKey: "git.example:8443/Team/Repo" }
    });
    expect(prismaMock.usageEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
      repoKey: "git.example:8443/Team/Repo",
      gitRemote: null
    });
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

describe("projectNameFromPath", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(projectNameFromPath("/Users/me/proj")).toBe("proj");
  });

  it("ignores a trailing separator", () => {
    expect(projectNameFromPath("/Users/me/proj/")).toBe("proj");
    expect(projectNameFromPath("C:\\Users\\me\\proj\\")).toBe("proj");
  });

  it("takes the last segment of a Windows path", () => {
    // Previously split on "/" only, so a Windows client's project name came
    // out as the entire path string.
    expect(projectNameFromPath("C:\\Users\\me\\proj")).toBe("proj");
  });

  it("takes the last segment of a Windows path in git's forward-slash form", () => {
    expect(projectNameFromPath("C:/Users/me/proj")).toBe("proj");
  });

  it("handles UNC paths", () => {
    expect(projectNameFromPath("\\\\server\\share\\proj")).toBe("proj");
  });

  it("does not split a POSIX path on backslashes", () => {
    // A backslash is a legal POSIX filename character — splitting on it here
    // would rename real projects on existing Linux/macOS clients.
    expect(projectNameFromPath("/home/me/weird\\dir")).toBe("weird\\dir");
  });

  it("falls back for a bare drive root", () => {
    expect(projectNameFromPath("C:\\")).toBe("Unknown Project");
  });

  it("falls back for empty input", () => {
    expect(projectNameFromPath(null)).toBe("Unknown Project");
    expect(projectNameFromPath(undefined)).toBe("Unknown Project");
    expect(projectNameFromPath("")).toBe("Unknown Project");
  });
});
