import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/harness-sign", () => ({ signingKeyReady: () => false }));

import { GET as readiness } from "../../app/api/health/route";
import { GET as liveness } from "../../app/api/health/live/route";
import { GET as capabilities } from "../../app/api/health/capabilities/route";
import { latestMigrationName } from "@/server/health";

const sha = "a".repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("GIT_COMMIT", sha);
  vi.stubEnv("AUTH_SECRET", "a-valid-auth-secret-with-at-least-32-chars");
  vi.stubEnv("ADMIN_TOKEN", "a-valid-admin-token-with-at-least-32-chars");
  vi.stubEnv("AUTH_RESEND_KEY", "re_valid");
  vi.stubEnv("AUTH_EMAIL_FROM", "noreply@example.test");
});

afterEach(() => vi.unstubAllEnvs());

describe("health layers", () => {
  it("answers liveness without database access", async () => {
    const response = liveness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, code: "alive", commit: sha });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("reports signing as read-only without making the core readiness fail", async () => {
    const response = capabilities();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capabilities: {
      authSession: true, admin: true, email: true, harnessGateSigning: "read_only"
    } });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("fails closed on missing login configuration before touching the database", async () => {
    vi.stubEnv("AUTH_RESEND_KEY", "");
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "config_not_ready", commit: sha });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("does not expose a database exception through the public response or log", async () => {
    const secret = "postgresql://sensitive-user:sensitive-password@host/db";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.$queryRaw.mockRejectedValueOnce(Object.assign(new Error(secret), { code: "P1001" }));
    try {
      const response = await readiness();
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body).toMatchObject({ ok: false, code: "database_unavailable", commit: sha });
      expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      expect(log.mock.calls[0][1]).toMatchObject({ requestId: body.requestId, stage: "database", errorCode: "P1001" });
    } finally {
      log.mockRestore();
    }
  });

  it("checks the checked-in latest migration marker after DB connectivity", async () => {
    expect(latestMigrationName()).toMatch(/^20\d{12}_/);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.$queryRaw.mockResolvedValueOnce([{ one: 1 }]).mockResolvedValueOnce([{ present: false }]);
    try {
      const response = await readiness();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, code: "schema_not_ready" });
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it("returns the deployed SHA only after config, DB, and migration checks", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ one: 1 }]).mockResolvedValueOnce([{ present: true }]);
    const response = await readiness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, code: "ready", commit: sha });
  });
});
