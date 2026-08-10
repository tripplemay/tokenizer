import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  deviceFindFirst: vi.fn(),
  generateToken: vi.fn(),
  hashToken: vi.fn(),
  tokenPrefix: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db", () => ({
  prisma: {
    enrollmentToken: { create: mocks.create, findFirst: mocks.findFirst },
    device: { findFirst: mocks.deviceFindFirst }
  }
}));
vi.mock("@/server/tokens", () => ({
  generateToken: mocks.generateToken,
  hashToken: mocks.hashToken,
  tokenPrefix: mocks.tokenPrefix
}));

import { GET, dynamic } from "../../app/api/admin/enrollment-tokens/[id]/route";
import { POST } from "../../app/api/admin/enrollment-tokens/route";
import { NextRequest } from "next/server";

const expiresAt = new Date("2026-08-10T18:00:00.000Z");
const usedAt = new Date("2026-08-10T17:30:00.000Z");

function statusRequest(id = "enrollment-1") {
  return new Request(`http://localhost/api/admin/enrollment-tokens/${id}`);
}

function statusContext(id = "enrollment-1") {
  return { params: Promise.resolve({ id }) };
}

describe("enrollment status endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findFirst.mockResolvedValue({ usedAt: null, usedById: null, expiresAt });
    mocks.deviceFindFirst.mockResolvedValue(null);
  });

  it("is force-dynamic and returns 401 for an unauthenticated request", async () => {
    expect(dynamic).toBe("force-dynamic");
    mocks.auth.mockResolvedValueOnce(null);

    const response = await GET(statusRequest(), statusContext());

    expect(response.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("scopes enrollment lookup to the signed-in tenant", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);

    const response = await GET(statusRequest("someone-elses-enrollment"), statusContext("someone-elses-enrollment"));

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-elses-enrollment", userId: "user-1" },
      select: { usedAt: true, usedById: true, expiresAt: true }
    });
  });

  it("reports an owned enrollment as unclaimed without querying a device", async () => {
    const response = await GET(statusRequest(), statusContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      usedAt: null,
      usedById: null,
      deviceName: null,
      expiresAt: expiresAt.toISOString()
    });
    expect(mocks.deviceFindFirst).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("returns the claimed device id and human-readable name in the same tenant", async () => {
    mocks.findFirst.mockResolvedValueOnce({ usedAt, usedById: "device-1", expiresAt });
    mocks.deviceFindFirst.mockResolvedValueOnce({ name: "Build Mac" });

    const response = await GET(statusRequest(), statusContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      usedAt: usedAt.toISOString(),
      usedById: "device-1",
      deviceName: "Build Mac",
      expiresAt: expiresAt.toISOString()
    });
    expect(mocks.deviceFindFirst).toHaveBeenCalledWith({
      where: { id: "device-1", userId: "user-1" },
      select: { name: true }
    });
  });
});

describe("enrollment token creation response", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.generateToken.mockReturnValue("enroll_secret");
    mocks.hashToken.mockImplementation((token: string) => `hash:${token}`);
    mocks.tokenPrefix.mockImplementation((token: string) => token.slice(0, 16));
    mocks.create.mockResolvedValue({ id: "enrollment-1" });
  });

  it("adds enrollmentId without changing the existing install command fields", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    const response = await POST(
      new NextRequest("https://app.example/api/admin/enrollment-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInMinutes: 30 })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enrollToken: "enroll_secret",
      expiresAt: expect.any(String),
      installCommand: "curl -fsSL https://app.example/install.sh | bash -s -- --enroll-token enroll_secret",
      installCommands: [
        { id: "posix", label: "macOS / Linux", command: "curl -fsSL https://app.example/install.sh | bash -s -- --enroll-token enroll_secret" },
        { id: "windows", label: "Windows", command: "& ([scriptblock]::Create((irm https://app.example/install.ps1))) -EnrollToken enroll_secret" }
      ],
      enrollmentId: "enrollment-1"
    });
  });
});
