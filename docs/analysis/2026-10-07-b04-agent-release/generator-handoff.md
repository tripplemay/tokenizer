# B04 Generator handoff -- candidate slice, not signoff

Base: `2074991717abaf3cb34d9aad894bcd4357fefbc3`; detached worktree:
`/Volumes/ORICO/project/.worktrees/tokenizer-b04-agent-release-20261007`.
No branch was pushed, no production deployment was attempted, and neither
`progress.json` nor any human gate decision was changed.

## Changed surface

- `src/shared/agent-releases.json`: backfilled fixed commit for current 1.4.0
  without touching Agent capability constants.
- `app/api/agent/releases/route.ts`: no-store public manifest endpoint;
  refuses an unpinned latest release.
- `public/install.sh`: fail-closed manifest fetch and commit verification;
  versioned staging, dependency/CLI smoke, symlink cutover, previous release,
  failure restoration, and offline manual rollback. Shared Agent data remains
  outside checkouts. New release-path process matching covers a daemon whose
  real path resolves through `releases/`.
- `public/install.ps1`: equivalent pin/staging/smoke flow with directory
  backup/restore and local rollback. No implicit `main` or branch install.
- `tests/cli/agent-release-installer.test.ts`: local Git fixture exercises
  POSIX first install, offline endpoint, nonexistent digest, npm failure,
  post-cutover configure failure, successful upgrade, and offline rollback;
  Windows receives only a static source guard here.
- `tests/server/agent-releases-route.test.ts` and
  `docs/agent-release-runbook.md`: manifest contract and operator protocol.

## Commands and observed results

- `bash -n public/install.sh`: exit 0.
- `npm run verify`: exit 0 (Prisma generate and `tsc --noEmit`).
- `npm run lint`: exit 0, no warnings/errors.
- `npm test`: exit 0, 1,456 passed / 20 skipped across 107 passing test
  files and 7 skipped test files on macOS. This is not cross-platform evidence.
- `npm run build`: exit 0; optimized Next build includes dynamic
  `/api/agent/releases` route.
- `vitest run tests/cli/agent-release-installer.test.ts
  tests/server/agent-releases-route.test.ts
  tests/cli/install-agent-lifecycle.test.ts
  tests/cli/service-windows.test.ts
  tests/shared/agent-release-version.test.ts`: targeted suite passed on macOS;
  Windows-only cases remained skipped. The fixture mocks npm and CLI smoke;
  it is not a real native dependency or supervisor test.
- `git ls-remote origin refs/heads/main`: returned the pinned baseline SHA
  when checked. No tag was created or verified.

## Known gaps / integration risks

1. B04 remains incomplete: no native Windows parser/runtime or scheduler
   upgrade/rollback run, no Linux systemd/cron fault injection, no real macOS
   launchd fault injection, and no disk-full/kill-window exercise.
2. The pin is a backfill of `1.4.0` to the current baseline. The Agent tag
   namespace has not been published. A formal release must decide the
   version/tag and independently verify the exact candidate commit.
3. POSIX first migration from physical `app/` cannot be atomic; restoration
   is best effort. Windows directory switching is non-atomic. Service restart
   can also fail and requires manual recovery.
4. The old `tests/cli/install-agent-lifecycle.test.ts` is intentionally not
   edited here because B01 owns Windows/POSIX lifecycle test changes. Its
   Windows CI outcome must be checked after integration.
5. `--purge` and manual token-rotation SOP were not implemented in this
   slice. Ordinary upgrade never rotates credentials or deletes queue/state.

Independent Evaluator should review the actual diff and run cross-platform
installer/service fault injection before any B04 acceptance claim.
