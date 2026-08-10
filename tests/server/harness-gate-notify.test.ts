import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { harnessGate: { findFirst: vi.fn(), updateMany: vi.fn() } }
}));
vi.mock("@/server/db", () => ({ prisma: mocks.prisma }));

import { consoleUrlFrom, notifyPendingGate, renderGateEmail } from "../../src/server/harness-gate-notify";

const SCOPE = {
  userId: "user-1",
  harnessProjectId: "hp-1",
  gateId: "BL-X-verifying-done-w1",
  requestOrigin: "https://token.example.test"
};

function gateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "gate-db-1",
    kind: "phase_advance",
    batch: "BL-X",
    fromStatus: "verifying",
    toStatus: "done",
    detail: "全 acceptance PASS，等待人类批准",
    raisedAt: new Date("2026-08-10T01:00:00.000Z"),
    harnessProject: { name: "tokenizer", repoKey: "github.com/acme/tokenizer" },
    user: { email: "owner@example.test" },
    ...overrides
  };
}

describe("gate email rendering", () => {
  it("renders subject and UTC body with the console link", () => {
    const { subject, text } = renderGateEmail({
      projectName: "tokenizer",
      repoKey: "github.com/acme/tokenizer",
      kind: "phase_advance",
      batch: "BL-X",
      fromStatus: "verifying",
      toStatus: "done",
      detail: "全 acceptance PASS",
      raisedAt: new Date("2026-08-10T01:00:00.000Z"),
      consoleUrl: "https://token.example.test/harness"
    });
    expect(subject).toBe("[tokenizer] 待批闸门：tokenizer · phase_advance · BL-X");
    expect(text).toContain("2026-08-10T01:00:00.000Z");
    expect(text).toContain("verifying → done");
    expect(text).toContain("https://token.example.test/harness");
  });

  it("prefers NEXT_PUBLIC_APP_URL over the request origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://public.example.test/");
    expect(consoleUrlFrom("https://internal.origin")).toBe("https://public.example.test/harness");
    vi.unstubAllEnvs();
    expect(consoleUrlFrom("https://internal.origin")).toBe("https://internal.origin/harness");
  });
});

describe("notifyPendingGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    mocks.prisma.harnessGate.findFirst.mockResolvedValue(gateRow());
    mocks.prisma.harnessGate.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips silently without a Resend key and never touches the database", async () => {
    vi.stubEnv("AUTH_RESEND_KEY", "");
    await notifyPendingGate(SCOPE);
    expect(mocks.prisma.harnessGate.findFirst).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends exactly once via an atomic claim on notifiedAt", async () => {
    await notifyPendingGate(SCOPE);
    expect(mocks.prisma.harnessGate.updateMany).toHaveBeenCalledWith({
      where: { id: "gate-db-1", notifiedAt: null },
      data: { notifiedAt: expect.any(Date) }
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_test_key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["owner@example.test"]);
    expect(body.subject).toContain("phase_advance");
  });

  it("stays silent when a concurrent report already claimed the gate", async () => {
    mocks.prisma.harnessGate.updateMany.mockResolvedValue({ count: 0 });
    await notifyPendingGate(SCOPE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips when the gate is missing or the user has no email", async () => {
    mocks.prisma.harnessGate.findFirst.mockResolvedValue(null);
    await notifyPendingGate(SCOPE);
    mocks.prisma.harnessGate.findFirst.mockResolvedValue(gateRow({ user: { email: null } }));
    await notifyPendingGate(SCOPE);
    expect(mocks.prisma.harnessGate.updateMany).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resets the claim for retry when the send fails, and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(notifyPendingGate(SCOPE)).resolves.toBeUndefined();
    const resetCall = mocks.prisma.harnessGate.updateMany.mock.calls.at(-1)?.[0];
    expect(resetCall.data).toEqual({ notifiedAt: null });
  });
});
