import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

const { getQuotaLatest } = await import("@/server/quota");

function row(overrides: Record<string, unknown>) {
  return {
    provider: "codex-chatgpt",
    accountKey: "account-a",
    windowKey: "rate_limit_primary",
    utilization: "0.2500",
    usedRaw: 25n,
    limitRaw: 100n,
    unit: "tokens",
    resetsAt: new Date("2026-08-11T00:00:00.000Z"),
    capturedAt: new Date("2026-08-10T10:00:00.000Z"),
    capturedBy: "device-a",
    deviceName: "Laptop A",
    rawJson: { source: "fixture" },
    ...overrides
  };
}

describe("getQuotaLatest account grouping", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
  });

  it("selects the latest window independently for each provider account", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ accountKey: "account-a" }),
      row({
        accountKey: "account-a",
        windowKey: "rate_limit_secondary",
        capturedAt: new Date("2026-08-10T11:00:00.000Z"),
        capturedBy: "device-a-new",
        deviceName: "Desktop A"
      }),
      row({
        accountKey: "account-b",
        windowKey: "credit_balance",
        capturedAt: new Date("2026-08-10T12:00:00.000Z"),
        capturedBy: "device-b",
        deviceName: "Laptop B"
      })
    ]);

    const latest = await getQuotaLatest("user-1");
    const accounts = latest.accountsByProvider["codex-chatgpt"];

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      accountKey: "account-a",
      capturedAt: "2026-08-10T11:00:00.000Z",
      capturedBy: { id: "device-a-new", name: "Desktop A" }
    });
    expect(accounts[0].windows.map((window) => window.windowKey)).toEqual([
      "rate_limit_primary",
      "rate_limit_secondary"
    ]);
    expect(accounts[1]).toMatchObject({
      accountKey: "account-b",
      capturedAt: "2026-08-10T12:00:00.000Z",
      capturedBy: { id: "device-b", name: "Laptop B" }
    });
    expect(accounts[1].windows.map((window) => window.windowKey)).toEqual(["credit_balance"]);
    expect(latest.byProvider["codex-chatgpt"]).toBe(accounts[1]);

    const query = (mocks.queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(query).toContain('DISTINCT ON (q."provider", q."accountKey", q."windowKey")');
    expect(query).toContain('ORDER BY q."provider", q."accountKey", q."windowKey", q."capturedAt" DESC');
  });

  it("keeps every account-level field equivalent for a single account", async () => {
    mocks.queryRaw.mockResolvedValue([row({})]);

    const latest = await getQuotaLatest("user-1");

    const expected = {
      accountKey: "account-a",
      capturedAt: "2026-08-10T10:00:00.000Z",
      capturedBy: { id: "device-a", name: "Laptop A" },
      windows: [
        {
          windowKey: "rate_limit_primary",
          utilization: 0.25,
          usedRaw: 25,
          limitRaw: 100,
          unit: "tokens",
          resetsAt: "2026-08-11T00:00:00.000Z",
          rawJson: { source: "fixture" }
        }
      ]
    };
    expect(latest.byProvider["codex-chatgpt"]).toEqual(expected);
    expect(latest.accountsByProvider["codex-chatgpt"]).toEqual([expected]);
  });
});
