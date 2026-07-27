import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceToken: vi.fn(),
  prisma: {
    harnessModeIntent: { updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }
  }
}));

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { GET, POST } from "../../app/api/harness/mode-intents/relay/route";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function request(method = "GET", body?: unknown) {
  return new Request("http://localhost/api/harness/mode-intents/relay", {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }) as never;
}

function ackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    harnessProjectId: "project-1",
    status: "relayed",
    stagedAt: null,
    stagedCommitSha: null,
    appliedAt: null,
    appliedBatch: null,
    failedAt: null,
    failureCode: null,
    failureDetail: null,
    ...overrides
  };
}

describe("device mode intent relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ userId: "user-1", deviceId: "device-1" });
    mocks.prisma.harnessModeIntent.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.harnessModeIntent.findMany.mockResolvedValue([]);
    mocks.prisma.harnessModeIntent.findFirst.mockResolvedValue(ackRow());
  });

  it("authenticates device GET, expires only that tenant/device, caps results, and relays issued rows", async () => {
    mocks.prisma.harnessModeIntent.findMany.mockResolvedValueOnce([
      {
        id: "row-issued",
        status: "issued",
        payload: { intent_id: "intent-1", expected_head_sha: HEAD },
        signature: "signed",
        harnessProject: { id: "project-1", repoKey: "github.com/acme/repo" }
      },
      {
        id: "row-relayed",
        status: "relayed",
        payload: { intent_id: "intent-2", expected_head_sha: HEAD },
        signature: "signed-2",
        harnessProject: { id: "project-1", repoKey: "github.com/acme/repo" }
      }
    ]);

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.prisma.harnessModeIntent.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        userId: "user-1",
        harnessProject: { deviceId: "device-1", userId: "user-1" },
        status: { in: ["issued", "relayed", "staged"] }
      },
      data: { status: "expired" }
    });
    expect(mocks.prisma.harnessModeIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          harnessProject: { deviceId: "device-1", userId: "user-1" },
          status: { in: ["issued", "relayed"] }
        }),
        take: 50
      })
    );
    expect(mocks.prisma.harnessModeIntent.updateMany.mock.calls[1][0]).toMatchObject({
      where: { id: { in: ["row-issued"] }, userId: "user-1", status: "issued" },
      data: { status: "relayed" }
    });
    const body = await response.json();
    expect(body.intents).toHaveLength(2);
    expect(body.intents[0]).toMatchObject({
      projectId: "project-1",
      repoKey: "github.com/acme/repo",
      intent: { intent_id: "intent-1", sig: "signed" }
    });
  });

  it("returns 404 without updates when project/device ownership does not match", async () => {
    mocks.prisma.harnessModeIntent.findFirst.mockResolvedValueOnce(null);
    const response = await POST(
      request("POST", {
        projectId: "foreign-project",
        intentId: "intent-1",
        status: "staged",
        stagedAt: "2026-07-27T12:00:00.000Z",
        stagedCommitSha: HEAD
      })
    );
    expect(response.status).toBe(404);
    expect(mocks.prisma.harnessModeIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          harnessProjectId: "foreign-project",
          userId: "user-1",
          harnessProject: { deviceId: "device-1", userId: "user-1" }
        })
      })
    );
    expect(mocks.prisma.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    "failed at /srv/private/repo",
    "failed at D:\\private\\repo",
    "failed at \\\\server\\share\\repo",
    "first line\nsecond line",
    "stderr: raw output",
    "api_key=secret-value"
  ])("rejects unsafe failure detail without querying or echoing it: %s", async (failureDetail) => {
    const response = await POST(
      request("POST", {
        projectId: "project-1",
        intentId: "intent-1",
        status: "failed",
        failedAt: "2026-07-27T12:00:00.1Z",
        failureCode: "stage_failed",
        failureDetail
      })
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(failureDetail);
    expect(mocks.prisma.harnessModeIntent.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("transitions relayed to staged with a tenant-scoped conditional update", async () => {
    const response = await POST(
      request("POST", {
        projectId: "project-1",
        intentId: "intent-1",
        status: "staged",
        stagedAt: "2026-07-27T12:00:00.000Z",
        stagedCommitSha: HEAD
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.harnessModeIntent.updateMany).toHaveBeenCalledWith({
      where: {
        id: "row-1",
        harnessProjectId: "project-1",
        userId: "user-1",
        status: { in: ["issued", "relayed"] }
      },
      data: {
        status: "staged",
        stagedAt: new Date("2026-07-27T12:00:00.000Z"),
        stagedCommitSha: HEAD
      }
    });
  });

  it("accepts an identical terminal ACK retry without another write", async () => {
    mocks.prisma.harnessModeIntent.findFirst.mockResolvedValueOnce(
      ackRow({
        status: "applied",
        appliedAt: new Date("2026-07-27T12:00:00.000Z"),
        appliedBatch: "BL-NEXT"
      })
    );
    const response = await POST(
      request("POST", {
        projectId: "project-1",
        intentId: "intent-1",
        status: "applied",
        appliedAt: "2026-07-27T12:00:00.000Z",
        appliedBatch: "BL-NEXT"
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ idempotent: true, status: "applied" });
    expect(mocks.prisma.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an applied ACK before staged and never updates a terminal/superseded state", async () => {
    mocks.prisma.harnessModeIntent.findFirst.mockResolvedValueOnce(ackRow({ status: "issued" }));
    const response = await POST(
      request("POST", {
        projectId: "project-1",
        intentId: "intent-1",
        status: "applied",
        appliedAt: "2026-07-27T12:00:00.000Z",
        appliedBatch: "BL-NEXT"
      })
    );
    expect(response.status).toBe(409);
    expect(mocks.prisma.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });
});
