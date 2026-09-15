import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

let fakeHome: string;
let restoreHome: () => void;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "tokenizer-codex-"));
  // os.homedir() prefers USERPROFILE on Windows and HOME elsewhere, so both
  // have to be redirected for the fake home to take effect on either OS.
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  restoreHome = () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  };
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  restoreHome();
  rmSync(fakeHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function writeCodexAuth(accessToken: string | null) {
  const dir = join(fakeHome, ".codex");
  mkdirSync(dir, { recursive: true });
  const body = accessToken ? { tokens: { access_token: accessToken } } : {};
  writeFileSync(join(dir, "auth.json"), JSON.stringify(body));
}

function mockFetch(response: { status: number; body?: unknown; throws?: Error }) {
  const fetchMock = vi.fn(async () => {
    if (response.throws) throw response.throws;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() { return response.body; },
      async text() { return JSON.stringify(response.body); },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("codexChatgptProvider", () => {
  it("preserves a weekly-only primary duration without inventing a secondary window", async () => {
    writeCodexAuth("fixture-token");
    const primary = { used_percent: 83, limit_window_seconds: 604800, reset_after_seconds: 320100, reset_at: 1789820507 };
    mockFetch({ status: 200, body: { plan_type: "pro", rate_limit: { primary_window: primary, secondary_window: null } } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const { snapshots } = await codexChatgptProvider.fetch();
    expect(snapshots.find((s) => s.windowKey === "rate_limit_primary")).toMatchObject({
      utilization: 0.83, rawJson: primary, resetsAt: "2026-09-19T12:21:47.000Z"
    });
    expect(snapshots.some((s) => s.windowKey === "rate_limit_secondary")).toBe(false);
  });

  it("isConfigured returns false when no access token", async () => {
    writeCodexAuth(null);
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    expect(await codexChatgptProvider.isConfigured()).toBe(false);
  });

  it("isConfigured returns true when access token is present", async () => {
    writeCodexAuth("sk-token");
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    expect(await codexChatgptProvider.isConfigured()).toBe(true);
  });

  it("fetch maps fixture response into snapshot rows by windowKey", async () => {
    writeCodexAuth("sk-token");
    const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/codex-chatgpt-response.json"), "utf8"));
    mockFetch({ status: 200, body: fixture });

    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();

    expect(result.error).toBeUndefined();
    expect(result.accountKey).toBe("acct-fixture-001");
    const keys = result.snapshots.map((s) => s.windowKey).sort();
    expect(keys).toContain("plan");
    expect(keys).toContain("rate_limit_primary");
    expect(keys).toContain("rate_limit_secondary");
    expect(keys).toContain("code_review_rate_limit_primary");
    expect(keys).toContain("credit_balance");

    const primary = result.snapshots.find((s) => s.windowKey === "rate_limit_primary");
    expect(primary?.utilization).toBeCloseTo(0.355);
    expect(primary?.unit).toBe("percent");
    expect(primary?.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const credit = result.snapshots.find((s) => s.windowKey === "credit_balance");
    expect(credit?.unit).toBe("usd");
    expect((credit?.rawJson as { balance?: number })?.balance).toBe(4.85);

    const plan = result.snapshots.find((s) => s.windowKey === "plan");
    expect(plan?.unit).toBe("label");
    expect((plan?.rawJson as { label?: string })?.label).toBe("plus");
  });

  it("returns error result on HTTP 401 without throwing", async () => {
    writeCodexAuth("sk-token");
    mockFetch({ status: 401, body: { error: "unauthorized" } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    expect(result.error?.code).toBe(401);
    expect(result.snapshots).toEqual([]);
  });

  it("returns error result on network error", async () => {
    writeCodexAuth("sk-token");
    mockFetch({ status: 0, throws: new Error("ETIMEDOUT") });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    expect(result.error).toBeDefined();
    expect(result.snapshots).toEqual([]);
  });

  it("falls back to auth.json account_id when response has no account_id", async () => {
    writeCodexAuth("sk-token");
    const dir = join(fakeHome, ".codex");
    writeFileSync(join(dir, "auth.json"), JSON.stringify({
      tokens: { access_token: "sk-token" },
      account_id: "fallback-acct",
    }));
    mockFetch({ status: 200, body: { plan_type: "plus" } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    expect(result.accountKey).toBe("fallback-acct");
  });

  it("marks credits.unlimited responses with utilization=0 and unlimited flag", async () => {
    writeCodexAuth("sk-token");
    mockFetch({ status: 200, body: { account_id: "acct-x", credits: { has_credits: true, unlimited: true, balance: 0 } } });
    const { codexChatgptProvider } = await import("@/quota/codex-chatgpt");
    const result = await codexChatgptProvider.fetch();
    const credit = result.snapshots.find((s) => s.windowKey === "credit_balance");
    expect(credit?.utilization).toBe(0);
    expect((credit?.rawJson as { unlimited?: boolean })?.unlimited).toBe(true);
  });
});
