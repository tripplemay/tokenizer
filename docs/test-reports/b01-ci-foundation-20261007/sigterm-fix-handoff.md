# B01 SIGTERM test-harness fix: Generator handoff

This is an isolated upgrade candidate, not an evaluator verdict or release
approval. Base: `2756ee622d258d87876a84ebe9a7186016d86304`. Worktree:
`/Volumes/ORICO/project/.worktrees/tokenizer-b01-sigterm-fix-20261007`.
No push, deployment, `progress.json`, `features.json`, or gate change.

## Reproduced boundary error

On Node 22.22.0, the original `node node_modules/tsx/dist/cli.mjs ...` command
spawned PID 18807 while `agent.lock.pid` was 18808. The negative diagnostic in
`sigterm-fix-evidence/baseline-owner-pid-negative.log` deterministically failed
the owner-PID equality assertion. For this diagnostic only, after waiting for
the existing running-state barrier, two lines were added to the baseline:

```ts
trackedPids.add(JSON.parse(readFileSync(lockPath, "utf8")).pid);
expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(agent.pid);
```

The first line ensured the diagnostic's child owner was killed on assertion
failure; it is absent from the final patch. This proves the PID-boundary
error, not a fresh reproduction of the original load-dependent lock failure.
The evaluator's captured full-suite failure remains the evidence for that
failure. Source inspection shows `runAgent` writes stopped state and releases
the lock before `process.exit(0)`, so waiting for the actual owner provides the
cleanup boundary that waiting for the tsx launcher did not provide.

## Minimal patch

Only the POSIX SIGTERM case in `tests/cli/agent-lifecycle.test.ts` changed:

- Spawn `process.execPath --import tsx src/cli/index.ts agent ...` directly.
- Keep the existing running-state barrier (signal handlers precede that write).
- Assert both lock and running-state PIDs equal the spawned child PID.
- Assert SIGTERM delivery, `{ code: 0, signal: null }` on termination, immediate
  lock removal, and stopped state with the same PID and a stopped timestamp.

No extra sleep, retry of cleanup assertions, skip, or timeout change. Product
code, Windows force-kill case, and the separate wrapper lifecycle case are
unchanged.

## Generator execution evidence

Environment: macOS arm64, Node 22.22.0, tsx 4.22.0, Vitest 2.1.9. Dependencies
installed by `npm ci` in this worktree; no shared `node_modules` or native
binding mutation. Set `PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH`
for the commands below. Raw output lives in `sigterm-fix-evidence/`.

| Command / check | Observed result | Evidence |
| --- | --- | --- |
| `npm ci` | exit 0; 641 packages installed | `npm-ci.log` |
| Owner-PID diagnostic on original launcher | exit 1; 18808 != 18807 | `baseline-owner-pid-negative.log` |
| `node node_modules/vitest/vitest.mjs run tests/cli/agent-lifecycle.test.ts` | exit 0; 6 passed, 1 Windows-only skipped | `focused-after.log` |
| 50 separate SIGTERM-only runs | all 50 exit 0; targeted test executed once each | `repeat-1.log` through `repeat-50.log` |
| `npm test`, three separate runs | each exit 0; 1516 passed, 22 skipped; 112 files passed, 8 skipped | `full-1.log` through `full-3.log` |
| `npm run lint` | exit 0; no warnings/errors | `lint.log` |
| `npm run verify` | exit 0; Prisma generation + TypeScript | `verify.log` |
| `DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder npm run build` | exit 0; Next production build | `build.log` |
| `git diff --check 2756ee6..HEAD -- tests/cli/agent-lifecycle.test.ts` | exit 0 | source-only whitespace check |

Focused repetition command (zsh):

```sh
for i in {1..50}; do
  node node_modules/vitest/vitest.mjs run tests/cli/agent-lifecycle.test.ts \
    -t 'releases the lock when the running agent receives SIGTERM' \
    > "docs/test-reports/b01-ci-foundation-20261007/sigterm-fix-evidence/repeat-$i.log" 2>&1 \
    || exit $?
done
```

The first full-suite run overlapped repeated SIGTERM runs and lint/verify;
subsequent full-suite runs overlapped repetition/build. This is scheduling-load
regression self-test evidence, not an evaluator-owned performance acceptance.
The six skips per filtered repeat are unselected tests, not SIGTERM skips.
Raw logs retain command-emitted CR/blank lines; all-path `git diff --check`
therefore reports log whitespace, not source whitespace. `SHA256SUMS` covers
the handoff, runtime metadata, and all 59 logs and was checked successfully.

## Required independent follow-up

Fresh-context evaluator should review the actual diff and rerun the PID,
SIGTERM/close, lock/state, and full-suite checks at the integrated commit.
The macOS execution does not establish Linux CI or Windows behavior. Default
full-suite skips remain: no PG/contract environment was configured. No new
browser/PG/contract acceptance or production-wrapper guarantee is claimed.
`npm ci` reported 21 dependency vulnerabilities; no dependency change or
`audit fix` was performed here (B02 scope). Historical F005 remains pending.
