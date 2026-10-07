# R02 Git remote privacy: Generator handoff

- Baseline: `2074991717abaf3cb34d9aad894bcd4357fefbc3` (detached worktree).
- Scope: review R02 only. This is implementation/test evidence, **not** independent Evaluator signoff or production acceptance.
- Source diff: `src/shared/git-remote.ts`, `src/cli/git.ts`, `src/cli/sync.ts`, `src/server/ingest.ts`.
- Test diff: `tests/cli/git.test.ts`, `tests/cli/sync-retry.test.ts`, `tests/server/ingest-project.test.ts`, `tests/server/git-privacy-db.probe.test.ts`.

## Behavior

- Parse HTTPS/HTTP, `git://`, SSH URL, SCP-style and bare canonical keys into `host[:nondefault-port]/path`; fold the host only, retain case-sensitive path, remove terminal `.git` for identity.
- `gitRemote` is a credential-free URL; userinfo, query and fragment never leave the collector in the Git fields. Unsupported/local/malformed remotes fail closed to `null` rather than uploading a raw URL.
- Re-sanitize legacy queued events immediately before HTTP and untrusted events before server project resolution, event persistence and error logging. The parsed remote takes precedence over a conflicting client `repoKey`.
- The existing `(userId, repoKey)` project lookup is retained; no cross-user repo merge or historical rewrite was introduced.

## Checks run locally

| Check | Result |
|---|---|
| Red-before focused CLI regression | 5 expected failures on baseline normalization/leak behavior |
| `npx vitest run tests/cli/git.test.ts tests/cli/sync-retry.test.ts tests/server/ingest-project.test.ts` | 42 passed |
| `DATABASE_URL=... EVAL_R02_DB_URL=... npx vitest run tests/server/git-privacy-db.probe.test.ts` | 1 passed against isolated loopback PostgreSQL 16.13, `scratch_r02`, after 28 `migrate deploy` migrations |
| `npm run lint` / `npm run verify` / `npm run build` | passed |
| `npm run test` | 1462 passed, 21 skipped on final rerun |
| `git diff --check` | passed |

The first full-suite rerun after build had 6 `harness-cost` failures (`Prisma.sql` undefined); the isolated file and immediate full rerun passed. The worktree used a symlink to the root checkout's `node_modules`, so dependency generation/concurrent-use interference is possible but not established. Re-run in an isolated Node 22 `npm ci` workspace for acceptance.

## Remaining gates and limits

- An independent Evaluator must inspect the diff and re-run the synthetic collector -> queue/wire -> PostgreSQL tests. The local probe does not test production, Windows, a real Agent upgrade, or browser rendering.
- Existing queued JSONL and historical `UsageEvent`/`Project` rows are **not** rewritten. Before any cleanup, back up and dry-run mappings per user; avoid merging distinct case-sensitive repositories. Decide token rotation with the authorized operator based on actual historical scan, not on these synthetic canaries.
- R06 raw parser payload privacy and Harness signed `repo_key` normalization are separate boundaries. `normalizeHarnessRepoKey` still lowercases the entire path; changing signed identity semantics needs its own compatibility tests and migration decision.
- Git metadata caching remains permanently stale until restart; R02 does not solve remote/branch/HEAD freshness.
