import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    device: { findUnique: vi.fn(), updateMany: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    harnessProject: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    harnessGate: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    harnessModeIntent: { updateMany: vi.fn() },
    harnessDispatchRun: { upsert: vi.fn() },
    harnessTransition: { create: vi.fn() },
    harnessBatchArchive: { upsert: vi.fn() }
  };
  return {
    authenticateDeviceToken: vi.fn(),
    tx,
    prisma: {
      project: { findFirst: vi.fn() },
      $transaction: vi.fn(),
      harnessProject: { findFirst: vi.fn(), findMany: vi.fn() }
    }
  };
});

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { POST } from "../../app/api/harness/report/route";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const PROJECT_ROW = { id: "harness-project-1", userId: "user-1", batch: "BL-TEST" };

function report(state: Record<string, unknown> = {}) {
  return {
    repoKey: "github.com/acme/tokenizer",
    name: "tokenizer",
    agent: { releaseVersion: "1.2.1", featureVersion: 9 },
    state: {
      status: "done",
      batch: "BL-TEST",
      fixRounds: 0,
      completed: 4,
      total: 4,
      headSha: HEAD,
      signoff: "docs/test-reports/BL-TEST-signoff.md",
      features: [{ id: "F001", title: "t", status: "completed", executor: "generator" }],
      modes: null,
      ...state
    },
    gate: null,
    dispatchRuns: []
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/harness/report", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

/** 既有镜像行（superseded 快照来源）：与路由 select 的形状一致 */
function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ROW.id,
    userId: "user-1",
    status: "verifying",
    batch: "BL-TEST",
    reportedAt: new Date("2026-08-09T10:00:00.000Z"),
    fixRounds: 1,
    completedCount: 3,
    totalCount: 4,
    headSha: HEAD,
    signoff: null,
    dashboardUrl: null,
    features: [{ id: "F001", title: "t", status: "completed", executor: "generator" }],
    ...overrides
  };
}

describe("harness report batch archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.prisma.project.findFirst.mockResolvedValue({ id: "usage-project-1" });
    mocks.prisma.harnessProject.findMany.mockResolvedValue([]);
    mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.findUnique.mockResolvedValue({ agentReleaseVersion: null, agentFeatureVersion: null });
    mocks.tx.harnessProject.findMany.mockResolvedValue([]);
    mocks.tx.harnessProject.findUnique.mockResolvedValue(null);
    mocks.tx.harnessProject.upsert.mockResolvedValue(PROJECT_ROW);
    mocks.tx.harnessGate.findMany.mockResolvedValue([]);
    mocks.tx.harnessGate.findUnique.mockResolvedValue(null);
    mocks.tx.harnessGate.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.harnessGate.upsert.mockResolvedValue({});
    mocks.tx.harnessModeIntent.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.harnessTransition.create.mockResolvedValue({});
    mocks.tx.harnessBatchArchive.upsert.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("archives the batch on entering done with firstPass derived from fixRounds", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(existing({ status: "reverifying", fixRounds: 0 }));
    const response = await POST(request(report({ fixRounds: 0 })));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessBatchArchive.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.tx.harnessBatchArchive.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      harnessProjectId_batch: { harnessProjectId: PROJECT_ROW.id, batch: "BL-TEST" }
    });
    expect(call.create).toMatchObject({
      userId: "user-1",
      repoKey: "github.com/acme/tokenizer",
      batch: "BL-TEST",
      status: "done",
      firstPass: true,
      archivedReason: "done",
      signoff: "docs/test-reports/BL-TEST-signoff.md"
    });
    expect(call.create.doneAt).toBeInstanceOf(Date);
    // 尾部刷新白名单不得包含建档判定字段
    expect(call.update).not.toHaveProperty("doneAt");
    expect(call.update).not.toHaveProperty("firstPass");
    expect(call.update).not.toHaveProperty("archivedReason");
  });

  it("keeps refreshing whitelist fields on tail reports of the same done batch", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(existing({ status: "done", fixRounds: 1 }));
    const response = await POST(request(report({ fixRounds: 1 })));
    expect(response.status).toBe(200);
    const call = mocks.tx.harnessBatchArchive.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ status: "done", fixRounds: 1, reportedAt: expect.any(Date) });
    // create 分支的 firstPass 由本次 fixRounds 派生；upsert 命中已有行时 update 不含它
    expect(call.create.firstPass).toBe(false);
  });

  it("snapshots an interrupted batch as superseded when the batch switches mid-flight", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(existing({ status: "verifying", batch: "BL-OLD" }));
    const response = await POST(request(report({ status: "building", batch: "BL-NEW", fixRounds: 0 })));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessBatchArchive.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.tx.harnessBatchArchive.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      harnessProjectId_batch: { harnessProjectId: PROJECT_ROW.id, batch: "BL-OLD" }
    });
    expect(call.create).toMatchObject({
      batch: "BL-OLD",
      status: "verifying",
      fixRounds: 1,
      completedCount: 3,
      totalCount: 4,
      firstPass: false,
      archivedReason: "superseded",
      doneAt: null
    });
    // 已有归档行（如已 done）不得被 superseded 覆盖
    expect(call.update).toEqual({});
  });

  it("does not archive while the batch is still in flight and never crosses tenants", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(existing({ status: "building" }));
    const response = await POST(request(report({ status: "verifying" })));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessBatchArchive.upsert).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.tx.harnessProject.findUnique.mockResolvedValue(existing({ userId: "user-2" }));
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    const conflict = await POST(request(report()));
    expect(conflict.status).toBe(403);
    expect(mocks.tx.harnessBatchArchive.upsert).not.toHaveBeenCalled();
  });
});
