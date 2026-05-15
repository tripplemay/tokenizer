# Tokenizer

Tokenizer collects real token usage from coding tools and sends it to a central server for per-project analysis.

Supported in the MVP:

- Claude Code: `~/.claude/usage-data/session-meta/*.json`
- Codex: `~/.codex/sessions/**/rollout-*.jsonl`
- OpenCode: diagnostic skeleton via `tokenizer diagnose opencode`

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Set a private API key in `.env`:

```env
APP_API_KEY=replace-me
DATABASE_URL=postgresql://tokenizer:tokenizer@localhost:5432/tokenizer
```

## CLI

Run the CLI from the project:

```bash
npm run cli -- init
npm run cli -- collect
npm run cli -- sync
```

Or link it globally:

```bash
npm link
tokenizer init
tokenizer run
```

Config is stored at:

```text
~/.tokenizer/config.json
```

Example config:

```json
{
  "serverUrl": "http://localhost:3000",
  "apiKey": "replace-me",
  "projectRoots": ["/Users/zhouyixing/project"],
  "sources": {
    "claude": true,
    "codex": true,
    "opencode": true
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
x-api-key: <APP_API_KEY>
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

## VPS Deployment

```bash
cp .env.example .env
# edit APP_API_KEY and NEXT_PUBLIC_APP_URL
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
```

Dashboard runs on port `3000` by default.

## Notes

- Ingestion is idempotent with `unique(source, sourceEventId)`.
- Claude Code and Codex parsers use real usage fields exposed by local logs.
- OpenCode parsing needs the actual local log format; start with `tokenizer diagnose opencode`.
