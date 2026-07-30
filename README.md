# Tokenizer

Tokenizer collects real token usage from coding tools and sends it to a central server for per-project analysis.

Supported in the MVP:

- Claude Code: `~/.claude/usage-data/session-meta/*.json`
- Codex: `~/.codex/sessions/**/rollout-*.jsonl`
- OpenCode: `~/.local/share/opencode/opencode.db` assistant messages
- Kimi Code: `~/.kimi-code/sessions/**/agents/*/wire.jsonl` `usage.record` turns

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Set an admin token in `.env`:

```env
ADMIN_TOKEN=replace-me
DATABASE_URL=postgresql://tokenizer:tokenizer@localhost:5432/tokenizer
```

## CLI

Run the CLI from the project:

```bash
npm run cli -- init
npm run cli -- enroll --enroll-token <enroll-token>
npm run cli -- collect
npm run cli -- sync
npm run cli -- diagnose opencode
npm run cli -- harness --status
npm run cli -- harness --json
```

Or link it globally:

```bash
npm link
tokenizer init
tokenizer run
```

Harness sync diagnostics are stored locally in `~/.tokenizer/state.json`. Use
`tokenizer harness --status` to read the latest snapshot without making any
network request. Use `tokenizer harness --json` to run one sync and emit only
the resulting JSON snapshot on stdout, which is suitable for scripts.

Snapshot status meanings:

- `idle`: no Harness projects were found and no sync issue occurred.
- `success`: at least one Harness operation succeeded and none failed.
- `degraded`: at least one operation succeeded and at least one issue occurred.
- `failed`: issues occurred and no Harness operation succeeded.

The console additionally marks a snapshot `stale` when its last attempt is
more than three minutes old. Structured issues contain only operation, bounded
project name, normalized code, and retryability; response bodies and local
paths are not included.

## Installing on a client machine

macOS / Linux:

```bash
curl -fsSL https://token.vpanel.cc/install.sh | bash -s -- --enroll-token <token>
```

Windows (PowerShell, no elevation required):

```powershell
& ([scriptblock]::Create((irm https://token.vpanel.cc/install.ps1))) -EnrollToken <token>
```

The background agent uses the platform's own supervisor: launchd on macOS,
a systemd user unit on Linux (cron where unavailable), and a Task Scheduler
job on Windows. The Windows task is logon-triggered with restart-on-failure,
which is the closest equivalent to launchd's `KeepAlive`.

Two Windows-specific notes:

- A scheduled task cannot carry environment variables, so `install-service`
  snapshots `HTTPS_PROXY` / `HTTP_PROXY` to `~/.tokenizer/proxy.json`. The live
  environment still wins when present, so changing your proxy in-shell works.
- `%USERPROFILE%\.local\share\opencode` is the correct OpenCode data path on
  Windows — OpenCode bundles an XDG library with no Windows branch, so it does
  not use `%LOCALAPPDATA%`.

Config is stored at:

```text
~/.tokenizer/config.json
```

Example config:

```json
{
  "serverUrl": "http://localhost:3000",
  "projectRoots": ["/Users/zhouyixing/project"],
  "sources": {
    "claude": true,
    "codex": true,
    "opencode": true,
    "kimicode": true
  }
}
```

Queue file for failed syncs:

```text
~/.tokenizer/queue.jsonl
```

## API

Batch ingestion:

```http
POST /api/usage/events/batch
authorization: Bearer <device-token>
content-type: application/json
```

Body:

```json
{
  "events": [
    {
      "source": "codex",
      "sourceEventId": "codex:file:1:timestamp",
      "projectName": "my-project",
      "workspacePath": "/Users/me/project/my-project",
      "model": "gpt-5.5",
      "inputTokens": 100,
      "outputTokens": 20,
      "totalTokens": 120,
      "occurredAt": "2026-05-15T00:00:00.000Z"
    }
  ]
}
```

Read endpoints:

- `GET /api/summary`
- `GET /api/summary/projects`
- `GET /api/summary/daily`
- `GET /api/events`
- `GET /api/projects`

## Model pricing

New vendor models are detected automatically and queued at `/admin/pricing`,
where an admin can price them (taking effect with no redeploy) or let an optional
LiteLLM/OpenRouter lookup pre-fill candidates. See
[`docs/auto-pricing.md`](docs/auto-pricing.md).

## VPS Deployment

```bash
cp .env.example .env
# edit ADMIN_TOKEN and NEXT_PUBLIC_APP_URL
docker compose up -d --build
```

The app container listens on port `3000`; compose publishes it to `127.0.0.1:3010` by default for reverse proxy deployments.

See `docs/VPS-deployment.md` for the full VPS setup, client configuration, upgrade, and backup workflow.

## Notes

- Ingestion is idempotent with `unique(source, sourceEventId)`.
- Claude Code and Codex parsers use real usage fields exposed by local logs.
- OpenCode parsing reads the local SQLite database and maps one assistant message to one usage event.
- OpenCode cache read tokens are stored as `cachedInputTokens`; cache write tokens are preserved in `rawJson` for now.
- **All timestamps are UTC, end-to-end.** Clients must send `occurredAt` as an ISO 8601 string in UTC (e.g. `2026-05-15T00:00:00.000Z`). The server, app container, and Postgres session all run in UTC; `occurredAt` / `createdAt` are stored as naive `timestamp` columns whose wall-clock value is UTC. Do not deploy any service in this stack with a non-UTC `TZ`.
