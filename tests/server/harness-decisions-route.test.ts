import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    device: { updateMany: vi.fn(), findUnique: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    harnessGate: { findMany: vi.fn(), updateMany: vi.fn() }
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

import { GET } from "../../app/api/harness/decisions/route";

const V9_HEADERS = {
  "x-tokenizer-agent-release-version": "1.2.1",
  "x-tokenizer-agent-feature-version": "9"
};

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/harness/decisions", {
    headers: { authorization: "Bearer token", ...headers }
  }) as never;
}

describe("harness decision relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.tx.device.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.findUnique.mockResolvedValue({ agentReleaseVersion: null, agentFeatureVersion: null });
    mocks.tx.harnessGate.findMany.mockResolvedValue([]);
    mocks.tx.harnessGate.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("scopes both delivery and relay markers to the authenticated user and device", async () => {
    const decisionAt = new Date("2026-08-02T12:00:00.000Z");
    mocks.tx.harnessGate.findMany.mockResolvedValueOnce([
      {
        id: "gate-row-1",
        gateId: "gate-1",
        decisionAction: "approve",
        decisionBy: "operator",
        decisionAt,
        decisionNote: null,
        decisionOnce: true,
        decisionSig: "signature",
        harnessProject: { repoKey: "github.com/acme/tokenizer" }
      }
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decisions: [
        {
          repoKey: "github.com/acme/tokenizer",
          gate_id: "gate-1",
          decision: {
            gate_id: "gate-1",
            action: "approve",
            by: "operator",
            at: "2026-08-02T12:00:00.000Z",
            scope: { once: true },
            sig: "signature"
          }
        }
      ]
    });
    expect(mocks.tx.harnessGate.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        harnessProject: { deviceId: "device-1", userId: "user-1" },
        decisionSig: { not: null },
        consumedAt: null
      },
      include: { harnessProject: { select: { repoKey: true } } },
      orderBy: { decisionAt: "asc" },
      take: 50
    });
    expect(mocks.tx.harnessGate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["gate-row-1"] }, userId: "user-1", relayedAt: null },
      data: { relayedAt: expect.any(Date) }
    });
  });

  it("returns unauthorized without querying a relay for an invalid device token", async () => {
    mocks.authenticateDeviceToken.mockResolvedValueOnce(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.tx.harnessGate.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.updateMany).not.toHaveBeenCalled();
  });

  it("does not mark a gate relayed when a capability-9 device omits Agent identity", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessGate.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.updateMany).not.toHaveBeenCalled();
  });

  it("does not mark a gate relayed when an older Agent identifies itself", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });

    const response = await GET(
      request({ ...V9_HEADERS, "x-tokenizer-agent-release-version": "1.2.0" })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_agent_report" });
    expect(mocks.tx.harnessGate.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.updateMany).not.toHaveBeenCalled();
  });

  it("allows a matching capability-9 identity to relay a signed decision", async () => {
    const decisionAt = new Date("2026-08-02T12:00:00.000Z");
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.1", agentFeatureVersion: 9 });
    mocks.tx.harnessGate.findMany.mockResolvedValueOnce([
      {
        id: "gate-row-1",
        gateId: "gate-1",
        decisionAction: "approve",
        decisionBy: "operator",
        decisionAt,
        decisionNote: null,
        decisionOnce: true,
        decisionSig: "signature",
        harnessProject: { repoKey: "github.com/acme/tokenizer" }
      }
    ]);

    const response = await GET(request(V9_HEADERS));

    expect(response.status).toBe(200);
    expect(mocks.tx.harnessGate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["gate-row-1"] }, userId: "user-1", relayedAt: null },
      data: { relayedAt: expect.any(Date) }
    });
  });

  it("fences a token revoked during force-enrollment before it can mark a gate relayed", async () => {
    mocks.tx.deviceToken.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await GET(request(V9_HEADERS));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "device_token_revoked" });
    expect(mocks.tx.harnessGate.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.harnessGate.updateMany).not.toHaveBeenCalled();
  });
});
