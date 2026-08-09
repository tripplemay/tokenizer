import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    device: { findUnique: vi.fn(), updateMany: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    harnessProject: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    harnessGate: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    harnessModeIntent: { updateMany: vi.fn() },
    harnessDispatchRun: { upsert: vi.fn() },
    harnessTransition: { create: vi.fn() }
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
      status: "building",
      batch: "BL-TEST",
      fixRounds: 0,
      completed: 0,
      total: 4,
      headSha: HEAD,
      features: [],
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

/** 既有镜像行：select { id, userId, status, batch, reportedAt } 的形状 */
function existing(status: string | null, batch: string | null, reportedAt: Date | null) {
  return { id: PROJECT_ROW.id, userId: "user-1", status, batch, reportedAt };
}

describe("harness report transition diff log", () => {
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
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("writes an initial observation row on the first report", async () => {
    const response = await POST(request(report()));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessTransition.create).toHaveBeenCalledTimes(1);
    const data = mocks.tx.harnessTransition.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "user-1",
      harnessProjectId: PROJECT_ROW.id,
      fromStatus: null,
      toStatus: "building",
      fromBatch: null,
      toBatch: "BL-TEST",
      batchBoundary: false,
      fixRounds: 0,
      headSha: HEAD,
      observedAfter: null
    });
    expect(data.observedAt).toBeInstanceOf(Date);
  });

  it("writes a fully attributed row when status changes", async () => {
    const previous = new Date("2026-08-09T10:00:00.000Z");
    mocks.tx.harnessProject.findUnique.mockResolvedValue(existing("building", "BL-TEST", previous));
    const response = await POST(request(report({ status: "verifying", fixRounds: 1 })));
    expect(response.status).toBe(200);
    const data = mocks.tx.harnessTransition.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      fromStatus: "building",
      toStatus: "verifying",
      fromBatch: "BL-TEST",
      toBatch: "BL-TEST",
      batchBoundary: false,
      fixRounds: 1,
      observedAfter: previous
    });
  });

  it("writes nothing when the reported status is unchanged", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(
      existing("building", "BL-TEST", new Date("2026-08-09T10:00:00.000Z"))
    );
    const response = await POST(request(report()));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessTransition.create).not.toHaveBeenCalled();
  });

  it("skips the degraded mirror (status null) without logging a transition", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(
      existing("building", "BL-TEST", new Date("2026-08-09T10:00:00.000Z"))
    );
    const response = await POST(request(report({ status: null, batch: null, headSha: null })));
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessTransition.create).not.toHaveBeenCalled();
  });

  it("marks a batch boundary when only the batch changes", async () => {
    mocks.tx.harnessProject.findUnique.mockResolvedValue(
      existing("building", "BL-OLD", new Date("2026-08-09T10:00:00.000Z"))
    );
    const response = await POST(request(report({ status: "building", batch: "BL-NEW" })));
    expect(response.status).toBe(200);
    const data = mocks.tx.harnessTransition.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      fromStatus: "building",
      toStatus: "building",
      fromBatch: "BL-OLD",
      toBatch: "BL-NEW",
      batchBoundary: true
    });
  });

  it("logs each leg of two fixing⟷reverifying rounds with the fixRounds snapshot", async () => {
    const legs: Array<{ prior: [string, number]; incoming: [string, number] }> = [
      { prior: ["verifying", 0], incoming: ["fixing", 1] },
      { prior: ["fixing", 1], incoming: ["reverifying", 1] },
      { prior: ["reverifying", 1], incoming: ["fixing", 2] },
      { prior: ["fixing", 2], incoming: ["reverifying", 2] }
    ];
    let at = Date.parse("2026-08-09T10:00:00.000Z");
    for (const leg of legs) {
      mocks.tx.harnessProject.findUnique.mockResolvedValue(existing(leg.prior[0], "BL-TEST", new Date(at)));
      at += 60_000;
      const response = await POST(request(report({ status: leg.incoming[0], fixRounds: leg.incoming[1] })));
      expect(response.status).toBe(200);
    }
    expect(mocks.tx.harnessTransition.create).toHaveBeenCalledTimes(4);
    const rows = mocks.tx.harnessTransition.create.mock.calls.map((call) => call[0].data);
    expect(rows.map((row) => [row.fromStatus, row.toStatus, row.fixRounds])).toEqual([
      ["verifying", "fixing", 1],
      ["fixing", "reverifying", 1],
      ["reverifying", "fixing", 2],
      ["fixing", "reverifying", 2]
    ]);
  });
});
