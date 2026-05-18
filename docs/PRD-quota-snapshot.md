# PRD — Quota Snapshot Capture (Codex + Claude Web)

Status: ready for implementation
Owner: TBD
Phase: 1 (parallelizable with PRD-jsonl-field-enrichment)

## 1. Background

Tokenizer today captures **token usage events** (what was consumed). Users have reported that openusage shows **subscription quota state** (what's remaining and when it resets) that we cannot — 5-hour utilization for Claude.ai/Pro, 7-day Sonnet/Opus windows, ChatGPT Plus credit balance, plan tier, rate limits. These data points are NOT present in any local file we already read. They come from the providers' web backend APIs:

- `https://claude.ai/api/organizations/{orgUUID}/usage` — authenticated via the Claude.ai `sessionKey` browser cookie. Returns `five_hour`, `seven_day`, `seven_day_sonnet`, `seven_day_opus`, `seven_day_cowork`, `seven_day_oauth_apps`, `extra_usage` — each with `utilization` (0..1 float) and `resets_at`.
- `https://chatgpt.com/backend-api/...` — authenticated via Codex CLI's plaintext `~/.codex/auth.json` token. Returns plan tier, credit balance, rate limits.

openusage extracts cookies locally and calls these endpoints from the user's machine. We adopt the same model — the agent on the user's machine performs the API call and pushes only the **resulting quota numbers** to our server. Cookies/tokens never leave the user's machine.

## 2. Goal

Ship a vertical slice that gives users a live "quota and remaining" view for the two highest-leverage providers (Claude.ai and ChatGPT/Codex), with the architecture in place to add more providers later.

## 3. In scope

- New `QuotaSnapshot` Prisma model (independent of `UsageEvent`).
- Provider modules for Claude Web and Codex/ChatGPT.
- CLI command `tokenizer auth login claude-web` for sessionKey paste; Codex auto-detects `~/.codex/auth.json`.
- Local-only auth storage at `~/.tokenizer/auth.json` (chmod 600).
- Agent main-loop quota refresh job (60s active / 300s idle) + `runOnce()` piggyback for cron users.
- Server endpoints: batch ingest + latest-per-window read.
- Minimal dashboard widget — without UI the captured data is invisible.
- Cookie expiration detection + Web UI "needs re-paste" status.

## 4. Out of scope

- Auto cookie extraction from Chrome / Firefox / Safari. v1 is paste-only across all OSes; this trades developer time against UX polish. v2 may add per-OS auto-extraction.
- Cursor / Copilot / Gemini / OpenRouter / Anthropic Console API quota. Phase 2+.
- User-configurable refresh intervals.
- Email / push notifications on quota threshold or expiration. v1 surfaces state only in Web UI.
- Server-side coordination of multi-device polling (every device polls independently in v1; load is negligible).
- OS keychain integration for the local auth file. v1 uses `chmod 600`.
- Cost / pricing inference from quota (we capture utilization and raw used/limit; converting to dollars is out of scope).

## 5. Decisions (locked)

| | |
|---|---|
| Data model | Independent `QuotaSnapshot` table, never delete history. |
| `accountKey` field | Yes — included from v1 to forward-support multi-account users. |
| Auth storage | `~/.tokenizer/auth.json` (chmod 600). Cookies/tokens never sent to our server. |
| Paste entry | CLI command. Web UI only displays status — never accepts cookies. |
| Refresh cadence | 60s for active devices, 300s for idle. Hardcoded; not user-configurable in v1. |
| Cookie expiry behavior | Agent writes local error state → device sync surfaces it → Web UI shows reconnect CTA. No emails. |

## 6. Data model

```prisma
model QuotaSnapshot {
  id           String    @id @default(cuid())
  userId       String
  provider     String    // "claude-web" | "codex-chatgpt"
  accountKey   String    // upstream account identifier (Anthropic orgUUID, ChatGPT account_id, ...)
  windowKey    String    // see §7 per-provider tables
  utilization  Decimal?  @db.Decimal(6, 4)
  usedRaw      BigInt?
  limitRaw     BigInt?
  unit         String?   // "tokens" | "messages" | "usd" | "requests" | "label"
  resetsAt     DateTime?
  capturedAt   DateTime  @default(now())
  capturedBy   String?   // deviceId
  rawJson      Json?

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  device Device? @relation(fields: [capturedBy], references: [id], onDelete: SetNull)

  @@index([userId, provider, windowKey, capturedAt])
}
```

History is append-only; "latest" is `SELECT DISTINCT ON (provider, windowKey) ... ORDER BY provider, windowKey, capturedAt DESC` (Postgres) or the equivalent groupBy in Prisma.

Add the inverse relation on `User` and `Device` models.

## 7. Provider window tables

### 7.1 `provider = "claude-web"`

Endpoint: `GET https://claude.ai/api/organizations/{orgUUID}/usage`

Auth: `Cookie: sessionKey=<sk-ant-sid01-...>` (plus `anthropic-device-id`, `lastActiveOrg`, optional `cf_clearance`, `__cf_bm` if needed — verify during spike).

Response keys → snapshot rows:

| Response key | `windowKey` | `utilization` | `resetsAt` | `unit` |
|---|---|---|---|---|
| `five_hour` | `"five_hour"` | from `.utilization` | from `.resets_at` | `null` |
| `seven_day` | `"seven_day"` | ditto | ditto | `null` |
| `seven_day_sonnet` | `"seven_day_sonnet"` | ditto | ditto | `null` |
| `seven_day_opus` | `"seven_day_opus"` | ditto | ditto | `null` |
| `seven_day_cowork` | `"seven_day_cowork"` | ditto | ditto | `null` |
| `seven_day_oauth_apps` | `"seven_day_oauth_apps"` | ditto | ditto | `null` |
| `extra_usage` | `"extra_usage"` | ditto | ditto | `null` |

`accountKey` = the Anthropic organization UUID. Discover it via `GET /api/organizations` if not pre-provided.

`usedRaw` / `limitRaw` left NULL — Claude only exposes utilization as a fraction.

### 7.2 `provider = "codex-chatgpt"`

Endpoint base: `https://chatgpt.com/backend-api/` (exact paths to be confirmed during spike — see §13).

Auth: token from `~/.codex/auth.json`. Codex CLI manages this file; we read-only.

Expected snapshot rows (final shape verified during spike):

| `windowKey` | semantics | `usedRaw` | `limitRaw` | `unit` |
|---|---|---|---|---|
| `plan` | plan tier label | `null` | `null` | `"label"`, label stored in `rawJson.label` |
| `credit_balance` | remaining credit | used | limit | `"usd"` if applicable |
| `rate_limit_short` | short-window rate limit | used | limit | `"requests"` |
| `rate_limit_long` | long-window rate limit | used | limit | `"requests"` |

`accountKey` = ChatGPT `account_id` if exposed, else a stable hash of the OAuth subject from `auth.json`.

## 8. Local auth file

`~/.tokenizer/auth.json`, chmod 600 on creation. Schema:

```json
{
  "providers": {
    "claude-web": {
      "sessionKey": "sk-ant-sid01-...",
      "orgUUID": "abc-123-...",
      "capturedAt": "2026-05-19T12:34:56Z"
    },
    "codex-chatgpt": {
      "source": "codex-auth-json",
      "lastReadAt": "2026-05-19T12:34:56Z"
    }
  }
}
```

The Codex entry is a marker, not a credential — the actual token lives in `~/.codex/auth.json`. We track when we last successfully read it so the Web UI can show freshness.

## 9. CLI surface

```
tokenizer auth login claude-web
tokenizer auth logout claude-web
tokenizer auth status
```

### `auth login claude-web`

Interactive. Prints in order:

1. A short instruction block telling the user how to obtain the `sessionKey` cookie from claude.ai (devtools → Application → Cookies). Include an explicit safety disclaimer: **"Only paste this into the official `tokenizer` CLI. We will never request your sessionKey via email, chat, web form, or any other channel."**
2. A masked prompt for the sessionKey.
3. An immediate validation call to `GET https://claude.ai/api/organizations`. On 200, store sessionKey + first orgUUID. On 401/403, error out and don't persist.

### `auth logout claude-web`

Removes the entry from `~/.tokenizer/auth.json`. No server call needed.

### `auth status`

Tabular print:

```
provider         status              account                refreshed
claude-web       connected           org abc-123            42s ago
codex-chatgpt    detected            chatgpt account-987    1m ago
cursor           not configured      —                      —
```

Status values: `connected` / `detected` / `expired` / `not configured` / `error: <reason>`.

## 10. Provider modules

New directory `src/quota/`:

- `src/quota/types.ts` — `QuotaSnapshotInput`, `QuotaProvider` interface (`async fetch(authFile) → { snapshots, accountKey, error? }`).
- `src/quota/auth-file.ts` — read/write `~/.tokenizer/auth.json` with 0o600 perms.
- `src/quota/claude-web.ts` — implements the Claude.ai endpoint call.
- `src/quota/codex-chatgpt.ts` — reads `~/.codex/auth.json` and calls chatgpt.com.
- `src/quota/registry.ts` — `runConfiguredProviders(config, authFile)` → `{ snapshots, errors }`.
- `src/quota/run.ts` — `runQuotaRefresh()` analogous to `runOnce` in `agent.ts`. Calls registry, batch-posts to server, updates state.

HTTP uses the project's existing `undici` dependency. Apply existing proxy-aware fetch (see `src/cli/service.ts` proxy env handling — same env var propagation strategy is expected to already work since `undici`'s `EnvHttpProxyAgent` is on).

## 11. Agent loop changes

`src/cli/agent.ts:82` `runAgent`:

- Add option `quotaRefreshSeconds: { active: number; idle: number }`. Defaults: `{ active: 60, idle: 300 }`.
- Track `lastQuotaRefreshAt` alongside `lastBeatAt` / `lastSyncAt`.
- Track `lastEventActivityAt` — updated whenever `runOnce` collects ≥ 1 new event. Active iff `Date.now() - lastEventActivityAt < 60 * 60 * 1000`.
- In `tick()`, compare `now - lastQuotaRefreshAt` against `active ? 60_000 : 300_000`.
- Call `runQuotaRefresh()` (defined in `src/quota/run.ts`) when the interval elapses, with the same `void` / single-flight gate pattern as `sync`.

`runOnce()`: at the end, after successful `syncEvents`, also call `runQuotaRefresh()` (single-flighted; non-fatal on error). This gives cron-fallback users (`tokenizer run` on a cron) the same quota freshness as daemon users at sync cadence.

`src/cli/service.ts`: no change required. The new `--heartbeat-seconds` / `--sync-minutes` flags stay; quota cadence is internal.

State persistence (`src/cli/config.ts` `updateState`): add fields:

```ts
lastQuotaRefreshAt?: string;
lastQuotaRefreshStatus?: "success" | "failed";
quotaAuthErrors?: Record<string, { code: number | string; lastFailedAt: string; consecutiveFailures: number }>;
```

## 12. Server endpoints

### `POST /api/quota/snapshots/batch`

Auth: bearer `device-token` (same scheme as `/api/usage/events/batch`).

Body:

```ts
{
  device?: DeviceInput;        // optional heartbeat-style update, same shape as events/batch
  snapshots: Array<{
    provider: string;
    accountKey: string;
    windowKey: string;
    utilization?: number;       // 0..1
    usedRaw?: number;           // server casts to BigInt
    limitRaw?: number;
    unit?: string;
    resetsAt?: string;          // ISO
    rawJson?: unknown;
  }>;
}
```

Response: `{ received: number; inserted: number }`. No dedup — every snapshot is appended; "latest" is derived on read.

### `GET /api/quota/latest`

Auth: user session (Web UI).

Query params: optional `provider=claude-web` filter.

Response:

```ts
{
  byProvider: Record<string, {
    accountKey: string;
    capturedAt: string;        // most recent capture across all windows
    capturedBy?: { id: string; name: string };
    windows: Array<{
      windowKey: string;
      utilization?: number;
      usedRaw?: number;
      limitRaw?: number;
      unit?: string;
      resetsAt?: string;
    }>;
  }>;
  errors: Array<{
    provider: string;
    code: number | string;
    lastFailedAt: string;
  }>;
}
```

Errors aggregated from `Device.diagnostics.quotaAuthErrors` across all devices for the user.

## 13. Auth + endpoint spike (do this before parser code)

The exact request signatures of `claude.ai/api/organizations/{org}/usage` and `chatgpt.com/backend-api` are undocumented. **Before writing parser code, the implementer must spike**:

1. Read openusage's reference implementation:
   - `internal/providers/claude_code/usage_api.go` (Claude endpoint, headers, response shape)
   - `internal/providers/codex/codex.go` (ChatGPT endpoint paths, auth.json field usage)
2. Make a manual `curl` against both endpoints with a real sessionKey / token to confirm:
   - Response JSON shape matches what openusage parses
   - No additional headers required (User-Agent, Origin, Referer pinning)
3. Save anonymized response samples to `tests/fixtures/quota-claude-web.json` and `tests/fixtures/quota-codex-chatgpt.json`. These fixtures power the unit tests in §14.

If either endpoint has changed shape since openusage's commit, document the new shape in this PRD before proceeding.

## 14. Tests

Vitest under `tests/`:

1. **Auth file roundtrip** — write then read `~/.tokenizer/auth.json`; assert `0o600` perms; assert merge semantics on partial writes.
2. **claude-web provider** — mocked fetch returning the fixture from §13; assert seven `QuotaSnapshotInput` rows produced with correct `windowKey` mapping.
3. **codex-chatgpt provider** — mocked fetch returning the fixture; assert plan / credit / rate-limit rows.
4. **Auth failure handling** — fetch returns 401; provider returns `{ snapshots: [], error: { code: 401 } }`; `runQuotaRefresh` writes `quotaAuthErrors[provider]` to state with `consecutiveFailures: 1`.
5. **Backoff after 3 consecutive failures** — registry skips a provider whose `consecutiveFailures >= 3` until next successful manual `auth login` clears the counter.
6. **Server batch endpoint** — POST 5 snapshots, assert all inserted, assert latest-per-window query returns the most recent capturedAt for each (provider, windowKey).
7. **Agent loop cadence** — fake timers; assert `runQuotaRefresh` fires at 60s when activity is recent, 300s after 1h of inactivity.

## 15. Minimal dashboard widget

Add a "Quotas" card to the existing dashboard. Read from `/api/quota/latest`.

Layout per provider:
- Provider label ("Claude.ai", "ChatGPT / Codex")
- Per window: name + horizontal utilization bar + `resets in Xh Ym` countdown
- Footer: "via device {name}, refreshed {N}s ago" + status badge (connected / expired / error)
- When `not configured`: a CTA card with `Run \`tokenizer auth login claude-web\` to connect`. Codex auto-detection failure ("install Codex CLI to enable") if `~/.codex/auth.json` missing.

Use the existing Chakra components. No new charting libraries. The card is read-only — no inputs, no actions beyond a refresh button that calls `/api/quota/latest` again.

## 16. Cookie / token expiry flow

Per provider, in the registry:

1. Fetch attempt → HTTP 401 / 403.
2. Provider returns `error: { code, message }` and an empty `snapshots` array.
3. `runQuotaRefresh` increments `quotaAuthErrors[provider].consecutiveFailures`, writes to state.json, includes in next heartbeat / sync diagnostics.
4. After `consecutiveFailures >= 3`: registry skips the provider on subsequent ticks (no further upstream calls) until either:
   - A successful `auth login claude-web` resets the counter, OR
   - For Codex: `~/.codex/auth.json` mtime changes (Codex CLI re-authed), in which case retry once.
5. Web UI surfaces a banner on the Quotas widget: `"Claude.ai disconnected — run \`tokenizer auth login claude-web\` on your machine to reconnect"`.

Server side: when `device.diagnostics.quotaAuthErrors` is non-empty, expose it through `GET /api/quota/latest`'s `errors[]` array.

## 17. Acceptance criteria

1. Fresh user runs `tokenizer auth login claude-web`, pastes a valid sessionKey → within 60s, `/api/quota/latest` returns ≥ 5 windowKeys for `claude-web` with `utilization` populated; dashboard widget renders them.
2. Fresh user with `~/.codex/auth.json` present runs `tokenizer agent` → within 60s, `/api/quota/latest` returns codex-chatgpt entries.
3. User invalidates their sessionKey by logging out of claude.ai. Within 3 agent ticks (≤ 5 minutes), Web UI shows the "disconnected" banner. No further upstream calls are made until the user re-pastes.
4. After 1 hour of zero UsageEvent activity, the agent's quota refresh interval drops from 60s to 300s (observable in `~/.tokenizer/logs/agent.log`).
5. Vitest suite passes including all tests in §14.
6. `prisma migrate dev` runs cleanly. Migration is reversible (`prisma migrate reset` works in test env).

## 18. Risks

| Risk | Mitigation |
|---|---|
| Anthropic / OpenAI change web-backend API shape | Each provider wraps fetch in try/catch, persists `rawJson` for forensics. Failure is per-provider; rest keep working. |
| Anthropic blocks the User-Agent or detects automation | First version uses a UA string identifying as `tokenizer-cli/<version>`. If Anthropic rate-limits, fall back to longer interval per-provider and document. |
| Multi-device duplicate polling | v1 accepts the load (~1.5 RPM per provider per user — well under any plausible threshold). v2 may add server-side coordination. |
| Cookie storage on disk | chmod 600 + clear documentation that the file is sensitive. v2: OS keychain. |
| Phishing risk via paste docs | CLI prompt prints explicit "we will never ask you for this elsewhere" disclaimer. Onboarding docs reinforce. |
| Legal/ToS — Anthropic & OpenAI both forbid scraping in some readings of their terms | Same risk surface as openusage. Use-case is "user inspecting their own subscription" not "redistribution of data". Document in onboarding that this is user-controlled, opt-in, optional. |

## 19. Handoff notes for implementer

Suggested implementation order (one full vertical slice at a time so each step is shippable):

1. **Schema + server endpoints** (no agent code yet) — land `QuotaSnapshot` model + batch + latest endpoints. Validate with `curl`.
2. **Codex provider** (no Claude yet) — `~/.codex/auth.json` is plaintext; no paste UX needed. Lands the registry, run loop, agent integration. Codex is the simpler vertical slice that proves the entire pipeline end-to-end.
3. **Dashboard widget** — read-only render of `/api/quota/latest`. With only Codex configured, the widget should already show one provider populated.
4. **Claude Web provider + `auth login` CLI** — adds the paste flow. With both providers configured, the widget shows both.
5. **Expiry / reconnect flow** — implement the 3-strike skip + Web UI banner.
6. **Tests + polish**.

Each step is independently mergeable. If the project's review process prefers smaller PRs, split steps 1–5 into separate PRs.

Files most relevant to read before starting:

- `src/cli/agent.ts:16-148` — `runOnce`, `runHeartbeat`, `runAgent` tick scheduler. Quota refresh follows the same pattern.
- `src/cli/sync.ts` — `syncEvents` and `heartbeat`. Add `syncQuotaSnapshots(config, snapshots)` here, modelled on `syncEvents`.
- `src/cli/config.ts` — `readConfig`, `updateState`. Extend `updateState` shape with the new quota fields.
- `prisma/schema.prisma` — UsageEvent for reference shape; add QuotaSnapshot alongside.
- openusage source on GitHub:
  - `internal/providers/claude_code/usage_api.go`
  - `internal/providers/codex/codex.go`
  - License is MIT; copying field paths and response shape is permitted with attribution. Do NOT copy code verbatim — re-implement.
