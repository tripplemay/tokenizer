import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signDecision: vi.fn(),
  prisma: {
    harnessGate: {
      findFirst: vi.fn(),
      updateMany: vi.fn()
    }
  }
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/harness-sign", () => ({
  HarnessSigningKeyMissingError: class HarnessSigningKeyMissingError extends Error {},
  signDecision: mocks.signDecision
}));

import { POST } from "../../app/api/harness/gates/route";

function gate(overrides: Record<string, unknown> = {}) {
  return {
    id: "gate-row-1",
    userId: "user-1",
    gateId: "BL-SECURITY-P1-verifying-done",
    decisionAction: null,
    decisionBy: null,
    consumedAt: null,
    ...overrides
  };
}

function request(action: "approve" | "reject" = "approve") {
  return new Request("http://localhost/api/harness/gates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "gate-row-1", action })
  }) as never;
}

describe("session gate decision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", email: "owner@example.test", name: "Owner" }
    });
    mocks.prisma.harnessGate.findFirst.mockResolvedValue(gate());
    mocks.prisma.harnessGate.updateMany.mockResolvedValue({ count: 1 });
    mocks.signDecision.mockReturnValue("signed-decision");
  });

  it("persists a decision with an unconsumed, undecided, tenant-scoped CAS", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      id: "gate-row-1",
      action: "approve",
      sig: "signed-decision"
    });
    expect(mocks.prisma.harnessGate.updateMany).toHaveBeenCalledWith({
      where: {
        id: "gate-row-1",
        userId: "user-1",
        decisionAction: null,
        consumedAt: null
      },
      data: {
        decisionAction: "approve",
        decisionBy: "owner@example.test",
        decisionAt: expect.any(Date),
        decisionNote: null,
        decisionOnce: true,
        decisionSig: "signed-decision"
      }
    });
  });

  it("allows exactly one of two concurrent decisions to expose its persisted signature", async () => {
    const persisted: Record<string, unknown> = {};
    let signatureNumber = 0;
    mocks.signDecision.mockImplementation(() => `signed-decision-${++signatureNumber}`);
    mocks.prisma.harnessGate.updateMany.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        if (persisted.decisionAction || persisted.consumedAt) return { count: 0 };
        Object.assign(persisted, data);
        return { count: 1 };
      }
    );

    const responses = await Promise.all([POST(request()), POST(request())]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const successIndex = responses.findIndex((response) => response.status === 200);
    const conflictIndex = responses.findIndex((response) => response.status === 409);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(persisted.decisionSig).toBe(bodies[successIndex].sig);
    expect(bodies[successIndex]).toMatchObject({ ok: true });
    expect(bodies[conflictIndex]).not.toHaveProperty("ok", true);
    expect(bodies[conflictIndex]).not.toHaveProperty("sig");
  });

  it.each([0, 2])("returns 409 and no success payload when CAS count is %i", async (count) => {
    mocks.prisma.harnessGate.updateMany.mockResolvedValueOnce({ count });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).not.toHaveProperty("ok", true);
    expect(body).not.toHaveProperty("sig");
  });

  it("does not overwrite a gate that was already consumed", async () => {
    mocks.prisma.harnessGate.findFirst.mockResolvedValueOnce(
      gate({ consumedAt: new Date("2026-08-10T12:00:00.000Z"), decisionBy: "existing-owner" })
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.signDecision).not.toHaveBeenCalled();
    expect(mocks.prisma.harnessGate.updateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite a gate that already has a decision", async () => {
    mocks.prisma.harnessGate.findFirst.mockResolvedValueOnce(
      gate({ decisionAction: "reject", decisionBy: "existing-owner" })
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.signDecision).not.toHaveBeenCalled();
    expect(mocks.prisma.harnessGate.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for another tenant's gate without attempting the CAS", async () => {
    mocks.prisma.harnessGate.findFirst.mockResolvedValueOnce(null);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.prisma.harnessGate.findFirst).toHaveBeenCalledWith({
      where: { id: "gate-row-1", userId: "user-1" }
    });
    expect(mocks.signDecision).not.toHaveBeenCalled();
    expect(mocks.prisma.harnessGate.updateMany).not.toHaveBeenCalled();
  });
});
