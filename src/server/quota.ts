import { unstable_cache } from "next/cache";
import { prisma } from "./db";

const CACHE_REVALIDATE_SECONDS = 30;

export type QuotaLatestWindow = {
  windowKey: string;
  utilization: number | null;
  usedRaw: number | null;
  limitRaw: number | null;
  unit: string | null;
  resetsAt: string | null;
  rawJson: unknown;
};

export type QuotaLatestProvider = {
  accountKey: string;
  capturedAt: string;
  capturedBy: { id: string; name: string | null } | null;
  windows: QuotaLatestWindow[];
};

export type QuotaLatest = {
  // Compatibility view for existing API consumers; the value is one complete,
  // most recently captured account. Use accountsByProvider for full rendering.
  byProvider: Record<string, QuotaLatestProvider>;
  accountsByProvider: Record<string, QuotaLatestProvider[]>;
};

type LatestRow = {
  provider: string;
  windowKey: string;
  accountKey: string;
  utilization: string | null;
  usedRaw: bigint | null;
  limitRaw: bigint | null;
  unit: string | null;
  resetsAt: Date | null;
  capturedAt: Date;
  capturedBy: string | null;
  deviceName: string | null;
  rawJson: unknown;
};

async function getQuotaLatestImpl(userId: string): Promise<QuotaLatest> {
  const rows = await prisma.$queryRaw<LatestRow[]>`
    SELECT DISTINCT ON (q."provider", q."accountKey", q."windowKey")
      q."provider", q."windowKey", q."accountKey",
      q."utilization", q."usedRaw", q."limitRaw", q."unit",
      q."resetsAt", q."capturedAt", q."capturedBy", q."rawJson",
      d."name" AS "deviceName"
    FROM "QuotaSnapshot" q
    LEFT JOIN "Device" d ON d."id" = q."capturedBy"
    WHERE q."userId" = ${userId}
    ORDER BY q."provider", q."accountKey", q."windowKey", q."capturedAt" DESC
  `;

  const grouped = new Map<string, Map<string, QuotaLatestProvider>>();
  for (const r of rows) {
    let accounts = grouped.get(r.provider);
    if (!accounts) {
      accounts = new Map<string, QuotaLatestProvider>();
      grouped.set(r.provider, accounts);
    }
    const provider = accounts.get(r.accountKey) ?? {
      accountKey: r.accountKey,
      capturedAt: r.capturedAt.toISOString(),
      capturedBy: r.capturedBy ? { id: r.capturedBy, name: r.deviceName } : null,
      windows: [],
    };
    provider.windows.push({
      windowKey: r.windowKey,
      utilization: r.utilization != null ? Number(r.utilization) : null,
      usedRaw: r.usedRaw != null ? Number(r.usedRaw) : null,
      limitRaw: r.limitRaw != null ? Number(r.limitRaw) : null,
      unit: r.unit,
      resetsAt: r.resetsAt ? r.resetsAt.toISOString() : null,
      rawJson: r.rawJson,
    });
    const capturedAtIso = r.capturedAt.toISOString();
    if (capturedAtIso > provider.capturedAt) {
      provider.capturedAt = capturedAtIso;
      provider.capturedBy = r.capturedBy ? { id: r.capturedBy, name: r.deviceName } : null;
    }
    accounts.set(r.accountKey, provider);
  }
  const accountsByProvider = Object.fromEntries(
    Array.from(grouped, ([provider, accounts]) => [provider, Array.from(accounts.values())])
  );
  const byProvider = Object.fromEntries(
    Object.entries(accountsByProvider).map(([provider, accounts]) => [
      provider,
      accounts.reduce((latest, account) =>
        account.capturedAt > latest.capturedAt ? account : latest
      )
    ])
  );
  return { byProvider, accountsByProvider };
}

export const getQuotaLatest = unstable_cache(
  getQuotaLatestImpl,
  ["getQuotaLatest"],
  { revalidate: CACHE_REVALIDATE_SECONDS }
);
