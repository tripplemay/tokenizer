import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceToken: vi.fn(),
  deviceUpdate: vi.fn(),
  tokenUpdate: vi.fn(),
  transaction: vi.fn(),
  updateTimezone: vi.fn()
}));

vi.mock("@/server/auth", () => ({
  authenticateDeviceToken: mocks.authenticateDeviceToken,
  unauthorized: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 })
}));
vi.mock("@/server/db", () => ({
  prisma: {
    device: { update: mocks.deviceUpdate },
    deviceToken: { update: mocks.tokenUpdate },
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

function request(diagnostics?: unknown) {
  return new Request("http://localhost/api/devices/heartbeat", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({
      device: {
        id: "device-1",
        name: "Workstation",
        ...(diagnostics === undefined ? {} : { diagnostics })
      }
    })
  }) as never;
}

describe("device heartbeat Harness diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceToken.mockResolvedValue({ id: "token-1", userId: "user-1", deviceId: "device-1" });
    mocks.deviceUpdate.mockReturnValue({ query: "device" });
    mocks.tokenUpdate.mockReturnValue({ query: "token" });
    mocks.transaction.mockResolvedValue([]);
  });

  it("persists a fully validated snapshot as explicit status/time plus bounded JSON", async () => {
    const response = await POST(request({ agentFeatureVersion: 5, harness: harness() }));
    expect(response.status).toBe(200);
    expect(mocks.deviceUpdate).toHaveBeenCalledWith({
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
  });

  it("keeps existing Harness columns untouched for an old heartbeat payload", async () => {
    const response = await POST(request({ agentVersion: "old-agent", queueDepth: 0 }));
    expect(response.status).toBe(200);
    const data = mocks.deviceUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("lastHarnessSyncAt");
    expect(data).not.toHaveProperty("harnessSyncStatus");
    expect(data).not.toHaveProperty("harnessDiagnostics");
    expect(data).not.toHaveProperty("agentReleaseVersion");
  });

  it("normalizes and persists a valid Agent release without replacing the diagnostic SHA", async () => {
    const response = await POST(request({ agentVersion: "commit-sha", agentReleaseVersion: "v1.0.0", agentFeatureVersion: 5 }));
    expect(response.status).toBe(200);
    expect(mocks.deviceUpdate).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: expect.objectContaining({
        agentVersion: "commit-sha",
        agentReleaseVersion: "1.0.0",
        agentFeatureVersion: 5
      })
    });
  });

  it.each([
    ["pre-release", { agentReleaseVersion: "1.0.0-beta" }, "invalid_agent_release_version"],
    ["leading-zero release", { agentReleaseVersion: "01.0.0" }, "invalid_agent_release_version"],
    ["negative capability", { agentFeatureVersion: -1 }, "invalid_agent_feature_version"],
    ["fractional capability", { agentFeatureVersion: 1.5 }, "invalid_agent_feature_version"],
    ["unsafe capability", { agentFeatureVersion: Number.MAX_SAFE_INTEGER + 1 }, "invalid_agent_feature_version"]
  ])("rejects %s before any write", async (_label, diagnostics, code) => {
    const response = await POST(request(diagnostics));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(code);
    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
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
    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
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
