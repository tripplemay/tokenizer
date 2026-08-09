import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: { harnessGate: { count: vi.fn() } }
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { GET } from "../../app/api/harness/gates/pending-count/route";

describe("pending gate count API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated callers with 401 before touching the database", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.prisma.harnessGate.count).not.toHaveBeenCalled();
  });

  it("counts only this user's unconsumed, undecided gates", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.harnessGate.count.mockResolvedValue(3);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: 3 });
    expect(mocks.prisma.harnessGate.count).toHaveBeenCalledWith({
      where: { userId: "user-1", consumedAt: null, decisionAction: null }
    });
  });
});
