/**
 * Real-Postgres probe for BL-SECURITY-P1 F004.
 *
 * Gated: requires a migrated scratch database and both URLs to match:
 *
 *   EVAL_F004_DB_URL=postgresql://postgres:pg@localhost:55441/scratch \
 *   DATABASE_URL=$EVAL_F004_DB_URL \
 *   npx vitest run tests/server/harness-gates-route-db.probe.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/server/db";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signDecision: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/harness-sign", () => ({
  HarnessSigningKeyMissingError: class HarnessSigningKeyMissingError extends Error {},
  signDecision: mocks.signDecision
}));

import { POST } from "../../app/api/harness/gates/route";

const DB_URL = process.env.EVAL_F004_DB_URL;
const USER_ID = "user-f004-gate-cas-probe";
const DEVICE_ID = "device-f004-gate-cas-probe";
const PROJECT_ID = "project-f004-gate-cas-probe";
const GATE_ID = "gate-f004-gate-cas-probe";

function request() {
  return new Request("http://localhost/api/harness/gates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: GATE_ID, action: "approve" })
  }) as never;
}

describe.skipIf(!DB_URL)("probe: gate decision CAS against real Postgres", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== DB_URL) {
      throw new Error("DATABASE_URL must exactly match EVAL_F004_DB_URL for the scratch probe");
    }

    mocks.auth.mockResolvedValue({
      user: { id: USER_ID, email: "f004-probe@example.test", name: "F004 Probe" }
    });
    let signatureNumber = 0;
    mocks.signDecision.mockImplementation(() => `probe-signature-${++signatureNumber}`);

    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.user.create({ data: { id: USER_ID, email: "f004-probe@example.test" } });
    await prisma.device.create({ data: { id: DEVICE_ID, userId: USER_ID, name: "F004 probe" } });
    await prisma.harnessProject.create({
      data: {
        id: PROJECT_ID,
        userId: USER_ID,
        deviceId: DEVICE_ID,
        repoKey: "github.com/acme/f004-gate-cas-probe",
        name: "F004 gate CAS probe",
        status: "verifying",
        batch: "BL-SECURITY-P1"
      }
    });
    await prisma.harnessGate.create({
      data: {
        id: GATE_ID,
        userId: USER_ID,
        harnessProjectId: PROJECT_ID,
        gateId: "BL-SECURITY-P1-verifying-done",
        kind: "phase_advance",
        batch: "BL-SECURITY-P1",
        fromStatus: "verifying",
        toStatus: "done",
        detail: "F004 concurrent decision probe",
        raisedAt: new Date("2026-08-10T12:00:00.000Z"),
        raisedBy: "evaluator"
      }
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  it("commits exactly one of two concurrent approvals and returns its stored signature", async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const successIndex = responses.findIndex((response) => response.status === 200);
    const conflictIndex = responses.findIndex((response) => response.status === 409);
    const stored = await prisma.harnessGate.findUniqueOrThrow({ where: { id: GATE_ID } });

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(stored.decisionAction).toBe("approve");
    expect(stored.decisionSig).toBe(bodies[successIndex].sig);
    expect(bodies[successIndex]).toMatchObject({ ok: true });
    expect(bodies[conflictIndex]).not.toHaveProperty("ok", true);
    expect(bodies[conflictIndex]).not.toHaveProperty("sig");
  });
});
