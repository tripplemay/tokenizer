import { readCodexAuthFile } from "./auth-file";
import type { QuotaProvider, QuotaProviderResult, QuotaSnapshotInput } from "./types";

const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10_000;

type WindowInfo = {
  used_percent?: number;
  remaining_percent?: number;
  window_minutes?: number;
  resets_at?: number;
  reset_at?: number;
};

type RateLimit = {
  primary_window?: WindowInfo;
  secondary_window?: WindowInfo;
};

type ChatGptUsageResponse = {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: RateLimit;
  code_review_rate_limit?: RateLimit;
  additional_rate_limits?: Array<Record<string, unknown>>;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: number };
};

export const codexChatgptProvider: QuotaProvider = {
  id: "codex-chatgpt",

  async isConfigured() {
    return readCodexAuthFile()?.tokens?.accessToken != null;
  },

  async fetch(): Promise<QuotaProviderResult> {
    const auth = readCodexAuthFile();
    const token = auth?.tokens?.accessToken;
    if (!token) {
      return {
        snapshots: [],
        accountKey: null,
        error: { code: "no_auth", message: "Codex auth.json missing or has no access_token" },
      };
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": `tokenizer-cli/${process.env.TOKENIZER_VERSION ?? "dev"}`,
    };
    const accountIdForHeader = auth.tokens?.accountId ?? auth.accountId;
    if (accountIdForHeader) headers["chatgpt-account-id"] = accountIdForHeader;

    try {
      const response = await fetch(CHATGPT_USAGE_URL, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          snapshots: [],
          accountKey: auth.accountId ?? null,
          error: { code: response.status, message: await response.text() },
        };
      }
      const data = (await response.json()) as ChatGptUsageResponse;
      const accountKey = data.account_id ?? auth.tokens?.accountId ?? auth.accountId ?? "unknown";
      return {
        snapshots: mapResponseToSnapshots(data, accountKey),
        accountKey,
      };
    } catch (err) {
      return {
        snapshots: [],
        accountKey: auth.accountId ?? null,
        error: { code: "fetch_error", message: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};

function mapResponseToSnapshots(data: ChatGptUsageResponse, accountKey: string): QuotaSnapshotInput[] {
  const rows: QuotaSnapshotInput[] = [];

  if (data.plan_type) {
    rows.push({
      provider: "codex-chatgpt",
      accountKey,
      windowKey: "plan",
      unit: "label",
      rawJson: { label: data.plan_type },
    });
  }

  if (data.rate_limit?.primary_window) {
    rows.push(snapshotFromWindow("rate_limit_primary", accountKey, data.rate_limit.primary_window));
  }
  if (data.rate_limit?.secondary_window) {
    rows.push(snapshotFromWindow("rate_limit_secondary", accountKey, data.rate_limit.secondary_window));
  }
  if (data.code_review_rate_limit?.primary_window) {
    rows.push(snapshotFromWindow("code_review_rate_limit_primary", accountKey, data.code_review_rate_limit.primary_window));
  }
  if (data.code_review_rate_limit?.secondary_window) {
    rows.push(snapshotFromWindow("code_review_rate_limit_secondary", accountKey, data.code_review_rate_limit.secondary_window));
  }
  if (data.additional_rate_limits && data.additional_rate_limits.length > 0) {
    data.additional_rate_limits.forEach((entry, idx) => {
      rows.push({
        provider: "codex-chatgpt",
        accountKey,
        windowKey: `additional_rate_limit_${idx}`,
        unit: "percent",
        rawJson: entry,
      });
    });
  }
  if (data.credits) {
    rows.push({
      provider: "codex-chatgpt",
      accountKey,
      windowKey: "credit_balance",
      utilization: data.credits.unlimited ? 0 : undefined,
      unit: "usd",
      rawJson: {
        balance: data.credits.balance,
        has_credits: data.credits.has_credits,
        unlimited: data.credits.unlimited,
      },
    });
  }

  return rows;
}

function snapshotFromWindow(windowKey: string, accountKey: string, w: WindowInfo): QuotaSnapshotInput {
  const resetSeconds = w.resets_at ?? w.reset_at;
  return {
    provider: "codex-chatgpt",
    accountKey,
    windowKey,
    utilization: w.used_percent != null ? w.used_percent / 100 : undefined,
    unit: "percent",
    resetsAt: resetSeconds != null ? new Date(resetSeconds * 1000).toISOString() : undefined,
    rawJson: w,
  };
}
