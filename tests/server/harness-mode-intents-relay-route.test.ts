import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    device: { updateMany: vi.fn(), findUnique: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    harnessModeIntent: { updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }
  };
  return {
    authenticateDeviceToken: vi.fn(),
    tx,
    prisma: { $transaction: vi.fn() }
  };
});

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { GET, POST } from "../../app/api/harness/mode-intents/relay/route";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

const V9_HEADERS = {
  "x-tokenizer-agent-release-version": "1.2.1",
  "x-tokenizer-agent-feature-version": "9"
};

function request(method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/harness/mode-intents/relay", {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json", ...headers },
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
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.tx.device.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.findUnique.mockResolvedValue({ agentReleaseVersion: null, agentFeatureVersion: null });
    mocks.tx.harnessModeIntent.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.harnessModeIntent.findMany.mockResolvedValue([]);
    mocks.tx.harnessModeIntent.findFirst.mockResolvedValue(ackRow());
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("authenticates device GET, expires only that tenant/device, caps results, and relays issued rows", async () => {
    mocks.tx.harnessModeIntent.findMany.mockResolvedValueOnce([
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
    expect(mocks.tx.harnessModeIntent.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        userId: "user-1",
        harnessProject: { deviceId: "device-1", userId: "user-1" },
        status: { in: ["issued", "relayed", "staged"] }
      },
      data: { status: "expired" }
    });
    expect(mocks.tx.harnessModeIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          harnessProject: { deviceId: "device-1", userId: "user-1" },
          status: { in: ["issued", "relayed"] }
        }),
        take: 50
      })
    );
    expect(mocks.tx.harnessModeIntent.updateMany.mock.calls[1][0]).toMatchObject({
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
    mocks.tx.harnessModeIntent.findFirst.mockResolvedValueOnce(null);
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
    expect(mocks.tx.harnessModeIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          harnessProjectId: "foreign-project",
          userId: "user-1",
          harnessProject: { deviceId: "device-1", userId: "user-1" }
        })
      })
    );
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
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
    expect(mocks.tx.harnessModeIntent.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("transitions relayed to staged with a tenant-scoped conditional update", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });
    const response = await POST(
      request(
        "POST",
        {
          projectId: "project-1",
          intentId: "intent-1",
          status: "staged",
          stagedAt: "2026-07-27T12:00:00.000Z",
          stagedCommitSha: HEAD
        },
        V9_HEADERS
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.tx.harnessModeIntent.updateMany).toHaveBeenCalledWith({
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
    mocks.tx.harnessModeIntent.findFirst.mockResolvedValueOnce(
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
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an applied ACK before staged and never updates a terminal/superseded state", async () => {
    mocks.tx.harnessModeIntent.findFirst.mockResolvedValueOnce(ackRow({ status: "issued" }));
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
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("keeps identity-less relays compatible until the device accepts capability 9", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessModeIntent.updateMany).toHaveBeenCalledOnce();
  });

  it("does not use the legacy compatibility branch to persist an identified older Agent", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 8 });

    const response = await GET(
      request("GET", undefined, {
        "x-tokenizer-agent-release-version": "1.2.0",
        "x-tokenizer-agent-feature-version": "8"
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessModeIntent.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed for a partial Agent identity before opening a relay transaction", async () => {
    const response = await GET(
      request("GET", undefined, { "x-tokenizer-agent-release-version": "1.2.1" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_agent_relay_identity" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.findMany).not.toHaveBeenCalled();
  });

  it("rejects a missing identity before GET can mark an intent relayed on a capability-9 device", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessModeIntent.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["oversized", 1_000_001],
    ["negative", -1]
  ])("fails closed for a missing identity when a stored capability is malformed: %s", async (_label, featureVersion) => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: featureVersion });

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessModeIntent.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale identity before POST can change staged, applied, or failed state", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await POST(
      request(
        "POST",
        {
          projectId: "project-1",
          intentId: "intent-1",
          status: "staged",
          stagedAt: "2026-07-27T12:00:00.000Z",
          stagedCommitSha: HEAD
        },
        { ...V9_HEADERS, "x-tokenizer-agent-release-version": "1.2.0" }
      )
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessModeIntent.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      "staged",
      {
        projectId: "project-1",
        intentId: "intent-1",
        status: "staged",
        stagedAt: "2026-07-27T12:00:00.000Z",
        stagedCommitSha: HEAD
      }
    ],
    [
      "applied",
      {
        projectId: "project-1",
        intentId: "intent-1",
        status: "applied",
        appliedAt: "2026-07-27T12:00:00.000Z",
        appliedBatch: "BL-NEXT"
      }
    ],
    [
      "failed",
      {
        projectId: "project-1",
        intentId: "intent-1",
        status: "failed",
        failedAt: "2026-07-27T12:00:00.000Z",
        failureCode: "stage_failed"
      }
    ]
  ])("rejects a missing identity before POST %s can write relay state", async (_status, ack) => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await POST(request("POST", ack));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessModeIntent.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("accepts capability-9 identity and atomically establishes it before relaying", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });
    mocks.tx.harnessModeIntent.findMany.mockResolvedValueOnce([
      {
        id: "row-issued",
        status: "issued",
        payload: { intent_id: "intent-1", expected_head_sha: HEAD },
        signature: "signed",
        harnessProject: { id: "project-1", repoKey: "github.com/acme/repo" }
      }
    ]);

    const response = await GET(request("GET", undefined, V9_HEADERS));

    expect(response.status).toBe(200);
    expect(mocks.tx.device.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "device-1", userId: "user-1" },
      data: { agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 }
    });
    expect(mocks.tx.harnessModeIntent.updateMany.mock.calls[1][0]).toMatchObject({
      data: { status: "relayed" }
    });
  });

  it.each([
    ["oversized", 1_000_001],
    ["negative", -1]
  ])("repairs a malformed %s stored capability with a valid capability-9 identity before relaying", async (_label, featureVersion) => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: featureVersion });

    const response = await GET(request("GET", undefined, V9_HEADERS));

    expect(response.status).toBe(200);
    expect(mocks.tx.device.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "device-1", userId: "user-1" },
      data: { agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 }
    });
  });

  it("takes relay timestamps after locking and checking the Device identity", async () => {
    const beforeGuard = new Date("2026-08-02T12:00:00.000Z");
    const afterGuard = new Date("2026-08-02T12:00:01.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(beforeGuard);
    mocks.tx.device.findUnique.mockImplementationOnce(async () => {
      vi.setSystemTime(afterGuard);
      return { agentReleaseVersion: null, agentFeatureVersion: null };
    });

    try {
      const response = await GET(request());

      expect(response.status).toBe(200);
      expect(mocks.tx.harnessModeIntent.updateMany.mock.calls[0][0]).toMatchObject({
        where: { intentExpiresAt: { lte: afterGuard } }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences a request whose token was revoked after authentication before any intent write", async () => {
    mocks.tx.deviceToken.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      request("POST", {
        projectId: "project-1",
        intentId: "intent-1",
        status: "staged",
        stagedAt: "2026-07-27T12:00:00.000Z",
        stagedCommitSha: HEAD
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "device_token_revoked" });
    expect(mocks.tx.harnessModeIntent.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.harnessModeIntent.updateMany).not.toHaveBeenCalled();
  });

  it("retries a serializable relay conflict before it writes relay state", async () => {
    mocks.prisma.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));

    const response = await GET(request("GET", undefined, V9_HEADERS));

    expect(response.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not misclassify an unexpected POST transaction failure as invalid input", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      POST(
        request("POST", {
          projectId: "project-1",
          intentId: "intent-1",
          status: "staged",
          stagedAt: "2026-07-27T12:00:00.000Z",
          stagedCommitSha: HEAD
        })
      )
    ).rejects.toThrow("database unavailable");
  });
});
