# B03 bounded replay safety repair: Generator handoff

This is Generator evidence, not an independent Evaluator verdict or a release
approval. Full B03 closeout remains outside this slice.

## Provenance and isolation

- Base: `420b539f8a233c11bf4b8c608d77db71df9dc488`.
- Product commit: `c69ef68edc3c973e3e9a2fc4a11d69009ebd01f1`.
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b03-replay-fixed-candidate-20261008`.
- Original technical pre-review: `a8a40726487cdb6e56a6a9d6a1c6b7476e3bf5e1`,
  retained unchanged in `tokenizer-b03-replay-prereview-20261008`.
  Its report is `docs/test-reports/B03-replay-technical-prereview-20261008/REPORT.md`.
- The pre-review was also same-family technical work, not formal cross-family
  acceptance. Its three failing safety controls and raw failures are not
  cherry-picked, edited, excluded, or relabeled as passing here. New successor
  regressions assert the same boundaries, including stronger parent races.
- Original/main/integration trees, progress/features, release gates and production
  data were not changed. No push. No new Vitest exclusion. The base's historical
  contract exclusion remains byte-identical.

## Narrow repair and decisive evidence

| Finding | Immutable pre-review observation | Successor regression |
| --- | --- | --- |
| R1 parent traversal | Directory symlink followed; one record accepted | Initial parent symlink/junction rejected; parent replacement before open and after read rejected; regular parent replacement with same leaf hardlink rejected |
| R2 blocking open | Regular file swapped to FIFO; child exceeded 12,005ms and was externally contained with ETIMEDOUT/SIGTERM; no safe refusal | POSIX open uses O_NONBLOCK with O_NOFOLLOW; fstat rejects FIFO; child exits 0 with FIFO_CREATED and SAFE_REFUSAL before 10s |
| R3 confirmation scope | Only projectRoots changed: wouldAdmit 0 -> 1 with identical digest; old digest admitted a row | projectRoots now contributes to digest; old digest and configuration change immediately before queue admission are rejected; merge must not run |

The only production change is `src/cli/replay.ts`. It checks every ancestor is a
non-symlink directory, records parent dev/ino, and rechecks before open, after open
before reading, and after reading. It retains the existing leaf identity/content
binding and finally-close behavior. Dot traversal is refused, not normalized away.
Ancestor mtime/ctime is intentionally not bound: unrelated sibling writes should
not make a stable source unusable.

On Windows, both initial and final native File.GetAttributes checks reject any
ReparsePoint, including tags not surfaced by Node's symbolic-link flag. The
PowerShell command receives a JSON path array through the environment, never
interpolates a path into executable source, requires an exact success marker,
and has only the remaining read deadline. Missing PowerShell, errors, unexpected
output or timeout fail closed. This slice only accepts local drive paths on
Windows; UNC/device/alternate-stream sources are explicitly refused. Windows
tests use junctions without requiring symbolic-link creation privilege and a
regular filename containing both spaces and an apostrophe.

This is checkpointed path/descriptor validation, not an OS-atomic openat or
NTCreateFile resolver. It does not claim to bound arbitrary kernel/filesystem
stalls or every hostile path interleaving. The fixed 10s regression is the
reproducible regular-to-FIFO open stall. Existing Git enrichment and queue-lock
behavior is unchanged, not newly asserted to have a global 10s deadline.

## Privacy and queue semantics retained

Include/exclude edits apply to subsequent collection only. Previously excluded
history is NOT implicitly backfilled. Historical recovery remains a separate,
explicit single-file bounded replay with dry-run and confirmation digest.
Explicit replay evaluates current rules and binds projectRoots, privacy mode,
scope fingerprint, range/budgets and file identity/content to confirmation.

Already admitted backlog is durable: changing rules does not refilter it;
local-only -> sync does not upload inside configure, but the next Agent/sync
cycle uploads retained backlog automatically. `privacy-admission-cli.test.ts`
executes the real CLI and proves: old admitted backlog/cursors survive; an old
excluded prefix remains absent after a rule change; only a later append is newly
collected; the next sync uploads exactly the retained and newly admitted rows.
Paused collection/replay leaves queue and cursor unchanged. Queue merge and ACK
regressions retain concurrent writer/backlog behavior. No cursor, source ID,
event wire identity, collector, parser, Agent or sync implementation was changed.

Original limits remain: one explicit Claude file, no recursive/sibling scanning,
16MiB input cap, 50,000 physical records, 1MiB line cap, 5,000 selected-event cap,
strict [from,to), bounded safe sample, no queue mutation in dry-run, explicit
digest execution and idempotent durable queue merge.

## Local validation (not native Windows or CI)

Node `v22.22.0`, macOS/darwin arm64, isolated npm ci. TMPDIR was a task-owned
ORICO directory. Full suite/build/stress were not run concurrently by this
Generator. Logs are retained verbatim under `evidence/`.

- Final frozen-source focused set: **92 passed / 1 skipped**, 9 files,
  `focused-final-3.log`. The skip is Windows-only unsupported-path rejection;
  POSIX FIFO negative runs and passes, not skipped. Development and intermediate
  focused logs remain, including the narrower 8-file final-2 set.
- Standard `npm test`: **1622 passed / 24 skipped**, twice, exit 0.
  `full-final.log` preceded a Windows-only private-helper optimization;
  `full-final-2.log` uses the exact committed production source. No timeout
  extensions, sleeps, or new exclusions were used to obtain these results.
- Final `npm run verify`, `npm run lint`, `npm run build`: exit 0.
  `verify-final-2.log`, `lint-final-2.log`, `build-final.log`.
- Original pre-review manifest: **14 OK**; old independent manifest **4 OK**;
  old Generator manifest **18 OK** from its required evidence cwd.
- `non-target-files.diff` is empty against base for collect/Agent/sync/index,
  parsers, vitest configuration, progress and features. Source/test diff check
  passed; verbatim logs may contain upstream whitespace.

Reproduce from this worktree with Node22 and a task-owned TMPDIR:

```sh
npm ci
node node_modules/vitest/vitest.mjs run tests/cli/replay-contract.test.ts tests/cli/replay-operational-contract.test.ts tests/cli/agent-sync-checkpoint.test.ts tests/cli/sync-retry.test.ts tests/cli/replay.test.ts tests/cli/queue-merge.test.ts tests/cli/replay-safety-regression.test.ts tests/cli/privacy-admission-cli.test.ts tests/cli/replay-help.test.ts
npm test
npm run verify
npm run lint
npm run build
shasum -a 256 -c docs/test-reports/B03-replay-generator-fix-20261008/evidence/SHA256SUMS
```

The FIFO fixture is an actual separate Node owner (`node --import tsx`); an
external 12s spawn timeout is containment only, not a replacement for the
asserted safe refusal before 10s.

## Remaining verification gates

Native Windows was NOT executed locally, and GitHub CI was NOT run by this
Generator. Coordinator must run native Windows Node22 focused/full checks,
specifically junction swaps before/after read, local regular paths with spaces
and apostrophe, the real PowerShell reparse query, safe refusal on unsupported
paths, and unchanged CLI queue/cursor behavior. Opaque non-junction reparse
fixture validation and permission/error behavior also remain native evidence
gaps; macOS success is not a substitute. Windows skips only the POSIX FIFO case.
Cross-family independent evaluation is still required. No release-ready or
full-B03 completion claim is made.

API design references (not runtime acceptance):
[Node22 filesystem flags](https://nodejs.org/docs/latest-v22.x/api/fs.html),
[File.GetAttributes](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.getattributes),
[Windows link attribute semantics](https://learn.microsoft.com/en-us/windows/win32/fileio/symbolic-link-effects-on-file-systems-functions).
The rolling Node22 docs are not evidence that a different Node patch was tested.
