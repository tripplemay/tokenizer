import { describe, expect, it, vi } from "vitest";
import type { QuotaProvider } from "@/quota/types";

function makeProvider(opts: {
  id: string;
  configured: boolean;
  result?: { snapshots?: unknown[]; accountKey?: string | null; error?: { code: number | string; message: string } };
  throws?: Error;
}): QuotaProvider {
  return {
    id: opts.id,
    isConfigured: vi.fn(async () => opts.configured),
    fetch: vi.fn(async () => {
      if (opts.throws) throw opts.throws;
      return {
        snapshots: (opts.result?.snapshots ?? []) as never,
        accountKey: opts.result?.accountKey ?? "acct-test",
        error: opts.result?.error,
      };
    }),
  };
}

describe("runConfiguredProviders", () => {
  it("skips providers whose isConfigured returns false", async () => {
    const a = makeProvider({ id: "a", configured: false });
    const b = makeProvider({ id: "b", configured: true, result: { snapshots: [{ provider: "b", accountKey: "", windowKey: "x" }] } });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([a, b]);
    expect(a.fetch).not.toHaveBeenCalled();
    expect(b.fetch).toHaveBeenCalled();
    expect(result.snapshots).toHaveLength(1);
  });

  it("collects errors per provider without aborting other providers", async () => {
    const failing = makeProvider({
      id: "failing",
      configured: true,
      result: { snapshots: [], error: { code: 401, message: "unauthorized" } },
    });
    const ok = makeProvider({
      id: "ok",
      configured: true,
      result: { snapshots: [{ provider: "ok", accountKey: "", windowKey: "x" }] },
    });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([failing, ok]);
    expect(result.errors.failing).toEqual({ code: 401, message: "unauthorized" });
    expect(result.snapshots).toHaveLength(1);
  });

  it("swallows provider exceptions and records them as errors", async () => {
    const throwing = makeProvider({ id: "throw", configured: true, throws: new Error("boom") });
    const ok = makeProvider({ id: "ok", configured: true, result: { snapshots: [{ provider: "ok", accountKey: "", windowKey: "x" }] } });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([throwing, ok]);
    expect(result.errors.throw).toBeDefined();
    expect(result.errors.throw.message).toContain("boom");
    expect(result.snapshots).toHaveLength(1);
  });

  it("backfills accountKey from provider result onto each snapshot", async () => {
    const provider = makeProvider({
      id: "p",
      configured: true,
      result: {
        snapshots: [
          { provider: "p", accountKey: "", windowKey: "a" },
          { provider: "p", accountKey: "should-be-overridden", windowKey: "b" },
        ],
        accountKey: "acct-real",
      },
    });
    const { runConfiguredProviders } = await import("@/quota/registry");
    const result = await runConfiguredProviders([provider]);
    expect(result.snapshots.every((s: { accountKey: string }) => s.accountKey === "acct-real")).toBe(true);
  });
});
