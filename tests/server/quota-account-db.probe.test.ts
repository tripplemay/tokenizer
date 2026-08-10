/**
 * Real-Postgres probe for BL-SECURITY-P1 F005.
 *
 * Gated: requires a migrated scratch database and both URLs to match:
 *
 *   EVAL_F005_DB_URL=postgresql://postgres:pg@localhost:55442/scratch \
 *   DATABASE_URL=$EVAL_F005_DB_URL \
 *   npx vitest run tests/server/quota-account-db.probe.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/server/db";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

const { getQuotaLatest } = await import("../../src/server/quota");

const DB_URL = process.env.EVAL_F005_DB_URL;
const USER_ID = "user-f005-quota-account-probe";
const DEVICE_A_ID = "device-f005-account-a";
const DEVICE_B_ID = "device-f005-account-b";

describe.skipIf(!DB_URL)("probe: quota accounts against real Postgres", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== DB_URL) {
      throw new Error("DATABASE_URL must exactly match EVAL_F005_DB_URL for the scratch probe");
    }

    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.user.create({ data: { id: USER_ID, email: "f005-quota-probe@example.test" } });
    await prisma.device.createMany({
      data: [
        { id: DEVICE_A_ID, userId: USER_ID, name: "Account A device" },
        { id: DEVICE_B_ID, userId: USER_ID, name: "Account B device" }
      ]
    });
    await prisma.quotaSnapshot.createMany({
      data: [
        {
          userId: USER_ID,
          provider: "codex-chatgpt",
          accountKey: "account-a",
          windowKey: "rate_limit_primary",
          utilization: 0.8,
          capturedAt: new Date("2026-08-10T10:00:00.000Z"),
          capturedBy: DEVICE_A_ID
        },
        {
          userId: USER_ID,
          provider: "codex-chatgpt",
          accountKey: "account-a",
          windowKey: "rate_limit_primary",
          utilization: 0.2,
          capturedAt: new Date("2026-08-10T11:00:00.000Z"),
          capturedBy: DEVICE_A_ID
        },
        {
          userId: USER_ID,
          provider: "codex-chatgpt",
          accountKey: "account-a",
          windowKey: "rate_limit_secondary",
          utilization: 0.3,
          capturedAt: new Date("2026-08-10T12:00:00.000Z"),
          capturedBy: DEVICE_A_ID
        },
        {
          userId: USER_ID,
          provider: "codex-chatgpt",
          accountKey: "account-b",
          windowKey: "rate_limit_primary",
          utilization: 0.4,
          capturedAt: new Date("2026-08-10T13:00:00.000Z"),
          capturedBy: DEVICE_B_ID
        },
        {
          userId: USER_ID,
          provider: "codex-chatgpt",
          accountKey: "account-b",
          windowKey: "credit_balance",
          usedRaw: 42n,
          capturedAt: new Date("2026-08-10T14:00:00.000Z"),
          capturedBy: DEVICE_B_ID
        }
      ]
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  it("keeps windows and capture metadata inside their provider account", async () => {
    const latest = await getQuotaLatest(USER_ID);
    const accounts = latest.accountsByProvider["codex-chatgpt"];

    expect(accounts.map((account) => account.accountKey)).toEqual(["account-a", "account-b"]);
    expect(accounts[0]).toMatchObject({
      capturedAt: "2026-08-10T12:00:00.000Z",
      capturedBy: { id: DEVICE_A_ID, name: "Account A device" }
    });
    expect(accounts[0].windows.map((window) => [window.windowKey, window.utilization])).toEqual([
      ["rate_limit_primary", 0.2],
      ["rate_limit_secondary", 0.3]
    ]);
    expect(accounts[1]).toMatchObject({
      capturedAt: "2026-08-10T14:00:00.000Z",
      capturedBy: { id: DEVICE_B_ID, name: "Account B device" }
    });
    expect(accounts[1].windows.map((window) => window.windowKey)).toEqual([
      "credit_balance",
      "rate_limit_primary"
    ]);
  });

  it("finds the additive account-aware index created by migrate deploy", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'QuotaSnapshot'
        AND indexname = 'QuotaSnapshot_user_provider_account_window_captured_idx'
    `;

    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef.replaceAll('"', "")).toContain(
      "(userId, provider, accountKey, windowKey, capturedAt)"
    );
  });
});
