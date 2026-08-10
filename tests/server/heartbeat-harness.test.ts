import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceToken: vi.fn(),
  transaction: vi.fn(),
  updateTimezone: vi.fn(),
  tx: {
    device: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    deviceToken: { updateMany: vi.fn() }
  }
}));

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/db", () => ({
  prisma: {
    $transaction: mocks.transaction
  }
}));
vi.mock("@/server/timezone", () => ({ updateUserTimezoneIfValid: mocks.updateTimezone }));

import { POST } from "../../app/api/devices/heartbeat/route";

function harness(overrides: Record<string, unknown> = {}) {
  return {
    attemptedAt: "2026-07-30T12:00:00.000Z",
    status: "degraded",
    reported: 2,
    failed: 1,
    relayed: 1,
    modeIntents: 0,
    issues: [{ operation: "report", project: "tokenizer", code: "http_400", retryable: false }],
    ...overrides
  };
}

function request(diagnostics?: unknown, deviceOverrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/devices/heartbeat", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({
      device: {
        id: "device-1",
        name: "Workstation",
        ...deviceOverrides,
        ...(diagnostics === undefined ? {} : { diagnostics })
      }
    })
  }) as never;
}

describe("device heartbeat Harness diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      deviceId: "device-1",
      prefix: "dtok_current"
    });
    mocks.tx.device.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.device.findUnique.mockResolvedValue({ agentReleaseVersion: null, agentFeatureVersion: null });
    mocks.tx.device.update.mockResolvedValue({ id: "device-1" });
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("persists a fully validated snapshot as explicit status/time plus bounded JSON", async () => {
    const response = await POST(request({ agentFeatureVersion: 5, harness: harness() }));
    expect(response.status).toBe(200);
    expect(mocks.tx.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: expect.objectContaining({
        agentFeatureVersion: 5,
        lastHarnessSyncAt: new Date("2026-07-30T12:00:00.000Z"),
        harnessSyncStatus: "degraded",
        harnessDiagnostics: {
          reported: 2,
          failed: 1,
          relayed: 1,
          modeIntents: 0,
          issues: [{ operation: "report", project: "tokenizer", code: "http_400", retryable: false }]
        }
      })
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.device.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.deviceToken.updateMany.mock.invocationCallOrder[0]);
    expect(mocks.tx.deviceToken.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.device.findUnique.mock.invocationCallOrder[0]);
  });

  it("cleans a long/control-character device name without rejecting the hot path", async () => {
    const response = await POST(request(undefined, { name: `Work\u0000station${"x".repeat(300)}` }));

    expect(response.status).toBe(200);
    const data = mocks.tx.device.update.mock.calls[0][0].data;
    expect(data.name).toBe(`Workstation${"x".repeat(189)}`);
    expect(data.name).toHaveLength(200);
    expect(data.name).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });

  it("keeps a legacy heartbeat liveness-only without marking it as an accepted reporter", async () => {
    const response = await POST(request({ agentVersion: "old-agent", queueDepth: 0 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      agentReleaseVersion: null,
      agentFeatureVersion: null
    });
    const data = mocks.tx.device.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("lastHarnessSyncAt");
    expect(data).not.toHaveProperty("harnessSyncStatus");
    expect(data).not.toHaveProperty("harnessDiagnostics");
    expect(data).not.toHaveProperty("agentReleaseVersion");
    expect(data).not.toHaveProperty("agentVersion");
    expect(data).not.toHaveProperty("queueDepth");
    expect(data).not.toHaveProperty("reporterTokenPrefix");
    expect(data).not.toHaveProperty("reportedAt");
    expect(data).toHaveProperty("lastSeenAt", expect.any(Date));
    expect(mocks.tx.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { id: "token-1", deviceId: "device-1", userId: "user-1", revokedAt: null },
      data: { lastUsedAt: expect.any(Date) }
    });
  });

  it("normalizes and persists a valid Agent release without replacing the diagnostic SHA", async () => {
    const response = await POST(request({ agentVersion: "commit-sha", agentReleaseVersion: "v1.0.0", agentFeatureVersion: 5 }));
    expect(response.status).toBe(200);
    expect(mocks.tx.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: expect.objectContaining({
        agentVersion: "commit-sha",
        agentReleaseVersion: "1.0.0",
        agentFeatureVersion: 5
      })
    });
  });

  it("does not let a stale reporter regress known versions or replace its diagnostics", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });

    const response = await POST(request({
      agentVersion: "old-sha",
      agentReleaseVersion: "1.1.0",
      agentFeatureVersion: 7,
      queueDepth: 99,
      lastError: "old failure",
      lastSyncStatus: "failed",
      harness: harness({ status: "failed" })
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      accepted: false,
      agentReleaseVersion: "1.2.0",
      agentFeatureVersion: 8
    });

    const data = mocks.tx.device.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Workstation", lastSeenAt: expect.any(Date) });
    for (const field of [
      "agentVersion",
      "agentReleaseVersion",
      "agentFeatureVersion",
      "queueDepth",
      "lastError",
      "lastErrorAt",
      "lastSyncStatus",
      "lastHarnessSyncAt",
      "harnessSyncStatus",
      "harnessDiagnostics",
      "reporterTokenPrefix",
      "reportedAt"
    ]) {
      expect(data).not.toHaveProperty(field);
    }
    expect(mocks.tx.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { id: "token-1", deviceId: "device-1", userId: "user-1", revokedAt: null },
      data: { lastUsedAt: expect.any(Date) }
    });
  });

  it.each([
    ["release", { agentReleaseVersion: "1.1.0", agentFeatureVersion: 8 }],
    ["feature", { agentReleaseVersion: "1.2.0", agentFeatureVersion: 7 }],
    ["missing version signal", { agentVersion: "unidentified-agent" }]
  ])("rejects a reporter with a stale or missing %s version dimension", async (_label, diagnostics) => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });

    const response = await POST(request(diagnostics));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      agentReleaseVersion: "1.2.0",
      agentFeatureVersion: 8
    });
    const data = mocks.tx.device.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("agentReleaseVersion");
    expect(data).not.toHaveProperty("agentFeatureVersion");
    expect(data).not.toHaveProperty("agentVersion");
  });

  it("accepts a newer reporter and records the accepted token prefix and report time", async () => {
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.9.0", agentFeatureVersion: 7 });

    const response = await POST(request({
      agentVersion: "new-sha",
      agentReleaseVersion: "v1.10.0",
      agentFeatureVersion: 8,
      harness: harness({ status: "success" })
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      accepted: true,
      agentReleaseVersion: "1.10.0",
      agentFeatureVersion: 8
    });
    expect(mocks.tx.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: expect.objectContaining({
        agentVersion: "new-sha",
        agentReleaseVersion: "1.10.0",
        agentFeatureVersion: 8,
        reporterTokenPrefix: "dtok_current",
        reportedAt: expect.any(Date)
      })
    });
  });

  it("retries a serialization conflict so the next read can apply the monotonic guard", async () => {
    mocks.transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.device.findUnique.mockResolvedValueOnce({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });

    const response = await POST(request({ agentReleaseVersion: "1.1.0", agentFeatureVersion: 7 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.tx.device.update).toHaveBeenCalledOnce();
  });

  it("rejects a token that was revoked after request authentication", async () => {
    mocks.tx.deviceToken.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 }));

    expect(response.status).toBe(401);
    expect(mocks.tx.device.updateMany).toHaveBeenCalledOnce();
    expect(mocks.tx.device.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.device.update).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { id: "token-1", deviceId: "device-1", userId: "user-1", revokedAt: null },
      data: { lastUsedAt: expect.any(Date) }
    });
  });

  it("aborts the transaction so a revoked token cannot commit its liveness fence", async () => {
    let persistedLastSeen: Date | null = null;
    mocks.tx.device.updateMany.mockImplementation(async ({ data }: { data: { lastSeenAt: Date } }) => {
      persistedLastSeen = data.lastSeenAt;
      return { count: 1 };
    });
    mocks.tx.deviceToken.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => {
      const before = persistedLastSeen;
      try {
        return await callback(mocks.tx);
      } catch (error) {
        persistedLastSeen = before;
        throw error;
      }
    });

    const response = await POST(request({ agentReleaseVersion: "1.2.0", agentFeatureVersion: 8 }));

    expect(response.status).toBe(401);
    expect(persistedLastSeen).toBeNull();
    expect(mocks.tx.device.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["pre-release", { agentReleaseVersion: "1.0.0-beta" }, "invalid_agent_release_version"],
    ["leading-zero release", { agentReleaseVersion: "01.0.0" }, "invalid_agent_release_version"],
    ["negative capability", { agentFeatureVersion: -1 }, "invalid_agent_feature_version"],
    ["fractional capability", { agentFeatureVersion: 1.5 }, "invalid_agent_feature_version"],
    ["unsafe capability", { agentFeatureVersion: Number.MAX_SAFE_INTEGER + 1 }, "invalid_agent_feature_version"],
    ["oversized capability", { agentFeatureVersion: 1_000_001 }, "invalid_agent_feature_version"]
  ])("rejects %s before any write", async (_label, diagnostics, code) => {
    const response = await POST(request(diagnostics));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(code);
    expect(mocks.tx.device.update).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown nested field", harness({ responseBody: "Bearer secret" })],
    ["non-UTC time", harness({ attemptedAt: "2026-07-30T12:00:00+00:00" })],
    ["invalid status", harness({ status: "partial" })],
    ["negative integer", harness({ failed: -1 })],
    ["unsafe integer", harness({ reported: Number.MAX_SAFE_INTEGER + 1 })],
    ["too many issues", harness({ issues: Array.from({ length: 21 }, () => ({ operation: "report", project: "p", code: "http_500", retryable: true })) })],
    ["unknown operation", harness({ issues: [{ operation: "upload", project: "p", code: "local_error", retryable: false }] })],
    ["unsafe code", harness({ issues: [{ operation: "report", project: "p", code: "token=secret", retryable: false }] })],
    ["absolute project path", harness({ issues: [{ operation: "report", project: "/Users/alice/private", code: "local_error", retryable: false }] })],
    ["null snapshot", null]
  ])("rejects %s before any write and does not echo its value", async (_label, value) => {
    const response = await POST(request({ harness: value }));
    expect(response.status).toBe(400);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("Bearer secret");
    expect(body).not.toContain("/Users/alice");
    expect(body).not.toContain("token=secret");
    expect(mocks.tx.device.update).not.toHaveBeenCalled();
    expect(mocks.tx.deviceToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("Harness health migration", () => {
  it("adds exactly the three nullable Device columns without a data backfill", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260730000000_add_harness_sync_diagnostics/migration.sql",
      "utf8"
    );
    expect(schema).toContain("lastHarnessSyncAt   DateTime?");
    expect(schema).toContain("harnessSyncStatus   String?");
    expect(schema).toContain("harnessDiagnostics  Json?");
    expect(migration.match(/ALTER TABLE "Device" ADD COLUMN/g)).toHaveLength(3);
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
  });
});

describe("Agent release migration", () => {
  it("adds one nullable release column without a data backfill", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260731000000_add_agent_release_version/migration.sql",
      "utf8"
    );
    expect(schema).toContain("agentReleaseVersion String?");
    expect(migration.match(/ALTER TABLE \"Device\" ADD COLUMN/g)).toHaveLength(1);
    expect(migration).toContain('"agentReleaseVersion" TEXT');
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
  });
});

describe("Device reporter observability migration", () => {
  it("adds nullable accepted-reporter fields and an index without a data backfill", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260802000000_add_device_reporter_observability/migration.sql",
      "utf8"
    );
    expect(schema).toContain("reporterTokenPrefix String?");
    expect(schema).toContain("reportedAt          DateTime?");
    expect(schema).toContain("@@index([reportedAt])");
    expect(migration.match(/ALTER TABLE \"Device\" ADD COLUMN/g)).toHaveLength(2);
    expect(migration).toContain('"reporterTokenPrefix" TEXT');
    expect(migration).toContain('"reportedAt" TIMESTAMP(3)');
    expect(migration).toContain('CREATE INDEX "Device_reportedAt_idx"');
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
  });
});
