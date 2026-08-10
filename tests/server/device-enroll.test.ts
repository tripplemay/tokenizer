import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    enrollmentToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    device: { findUnique: vi.fn(), upsert: vi.fn() },
    deviceToken: { updateMany: vi.fn(), create: vi.fn() }
  };
  return {
    tx,
    transaction: vi.fn(),
    generateToken: vi.fn(),
    hashToken: vi.fn(),
    tokenPrefix: vi.fn()
  };
});

vi.mock("@/server/db", () => ({
  prisma: { $transaction: mocks.transaction }
}));
vi.mock("@/server/tokens", () => ({
  generateToken: mocks.generateToken,
  hashToken: mocks.hashToken,
  tokenPrefix: mocks.tokenPrefix
}));

import { POST } from "../../app/api/devices/enroll/route";

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/devices/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enrollToken: "enroll_secret",
      device: { id: "device-1", name: "Workstation", hostname: "host-1", platform: "darwin" },
      ...overrides
    })
  }) as never;
}

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: "enrollment-1",
    userId: "user-1",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides
  };
}

describe("device enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashToken.mockImplementation((token: string) => `hash:${token}`);
    mocks.tokenPrefix.mockImplementation((token: string) => token.slice(0, 16));
    mocks.generateToken.mockReturnValue("dtok_reenrolled_secret");
    mocks.tx.enrollmentToken.findUnique.mockResolvedValue(enrollment());
    mocks.tx.enrollmentToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.findUnique.mockResolvedValue({ userId: "user-1" });
    mocks.tx.device.upsert.mockResolvedValue({ id: "device-1", name: "Workstation" });
    mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 2 });
    mocks.tx.deviceToken.create.mockResolvedValue({ id: "new-token" });
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("rotates a device credential by revoking all active tokens before creating the replacement", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      device: { id: "device-1", name: "Workstation" },
      deviceToken: "dtok_reenrolled_secret"
    });
    expect(mocks.tx.enrollmentToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enrollment-1",
        usedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      data: { usedAt: expect.any(Date), usedById: "device-1" }
    });
    expect(mocks.tx.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { deviceId: "device-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(mocks.tx.deviceToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        deviceId: "device-1",
        tokenHash: "hash:dtok_reenrolled_secret",
        prefix: "dtok_reenrolled_",
        lastUsedAt: expect.any(Date)
      })
    });
    expect(mocks.tx.deviceToken.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.deviceToken.create.mock.invocationCallOrder[0]);
  });

  it.each([
    ["missing", null],
    ["used", enrollment({ usedAt: new Date() })],
    ["expired", enrollment({ expiresAt: new Date(Date.now() - 1_000) })]
  ])("does not change credentials for a %s enrollment token", async (_label, fixture) => {
    mocks.tx.enrollmentToken.findUnique.mockResolvedValueOnce(fixture);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.tx.enrollmentToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.device.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.create).not.toHaveBeenCalled();
  });

  it("does not issue another device token when the conditional one-time claim loses a race", async () => {
    mocks.tx.enrollmentToken.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.tx.device.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.create).not.toHaveBeenCalled();
  });

  it("does not let another tenant take over an existing device ID", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ userId: "other-user" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.tx.enrollmentToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.device.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.create).not.toHaveBeenCalled();
  });

  it.each([
    ["an overlong name", { name: "x".repeat(201) }],
    ["a name containing a control character", { name: "Work\u0000station" }]
  ])("hard-rejects %s before claiming the enrollment", async (_label, devicePatch) => {
    const response = await POST(request({ device: { id: "device-1", ...devicePatch } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_device_name" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
