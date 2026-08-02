import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceToken: vi.fn(),
  prisma: {
    harnessGate: { findMany: vi.fn(), updateMany: vi.fn() }
  }
}));

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 })
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { GET } from "../../app/api/harness/decisions/route";

describe("harness decision relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ userId: "user-1", deviceId: "device-1" });
    mocks.prisma.harnessGate.findMany.mockResolvedValue([]);
    mocks.prisma.harnessGate.updateMany.mockResolvedValue({ count: 0 });
  });

  it("scopes both delivery and relay markers to the authenticated user and device", async () => {
    const decisionAt = new Date("2026-08-02T12:00:00.000Z");
    mocks.prisma.harnessGate.findMany.mockResolvedValueOnce([
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

    const response = await GET(new Request("http://localhost/api/harness/decisions") as never);

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
    expect(mocks.prisma.harnessGate.findMany).toHaveBeenCalledWith({
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
    expect(mocks.prisma.harnessGate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["gate-row-1"] }, userId: "user-1", relayedAt: null },
      data: { relayedAt: expect.any(Date) }
    });
  });

  it("returns unauthorized without querying a relay for an invalid device token", async () => {
    mocks.authenticateDeviceToken.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/harness/decisions") as never);

    expect(response.status).toBe(401);
    expect(mocks.prisma.harnessGate.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.harnessGate.updateMany).not.toHaveBeenCalled();
  });
});
