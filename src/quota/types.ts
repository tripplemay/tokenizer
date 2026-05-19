export type QuotaSnapshotInput = {
  provider: string;
  accountKey: string;
  windowKey: string;
  utilization?: number;     // 0..1
  usedRaw?: number;         // server casts to BigInt
  limitRaw?: number;
  unit?: string;
  resetsAt?: string;        // ISO
  rawJson?: unknown;
};

export type QuotaProviderError = {
  code: number | string;
  message: string;
};

export type QuotaProviderResult = {
  snapshots: QuotaSnapshotInput[];
  accountKey: string | null;
  error?: QuotaProviderError;
};

export type QuotaProvider = {
  id: string;
  isConfigured(): Promise<boolean>;
  fetch(): Promise<QuotaProviderResult>;
};
