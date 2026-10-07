# B03 + B07 combination Generator report

Date: 2026-10-08

This is a Generator handoff, not an independent evaluator verdict or release
approval.

## Inputs and output

- Integration base: `872ba3634d7c345dba33c32d57bd2f5773b6ca0a`
- B03 input: `6a030f6a3099684058cd5caed049f943cf03ab9a`
- B07 input: `541287603bf3ee41d1d86adde8328d2f9b3ae437`
- Combined product/test candidate: `116a1fffb2bd8c800f721adf1cd99653981da2df`
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b03-b07-combination-20261008`
- Branch: `codex/b03-b07-combination-20261008` (not pushed by this Generator)
- Safe-branch CI dispatched by the orchestrator for the exact candidate:
  run `37675079483`; terminal result was not available when this report was
  frozen.

## Conflict resolution

The combination retains one durable queue implementation in
`src/cli/queue.ts`.

1. B03's `mergeQueue(events, path, { timeoutMs, beforeMutate })` contract is
   preserved, including a custom queue path for tests, bounded lock acquisition,
   and `beforeMutate` execution while the queue lock is held immediately before
   the atomic write.
2. Merge and ACK identity use B07's normalized exact event version. Different
   versions of one `source + sourceEventId` coexist, and an ACK removes only the
   exact in-flight version. A newly collected corrected version is not deleted.
3. B07's current-disk-under-lock semantics remain in the Agent and sync path.
   No callback writes an old `remaining` snapshot over events collected by a
   second process.
4. B03 replay keeps the same 10-second deadline across inspection, bounded Git
   enrichment, final configuration/scope binding, lock acquisition and the
   final under-lock write guard. Both pre- and post-enrichment privacy filters
   remain.
5. B06 partial ACK, bounded rowless legacy-server isolation, exact rejected-row
   quarantine, quarantine-before-delete ordering and owner-only atomic files
   remain on the combined queue layer.
6. Historical callback shape keeps `acknowledged` for compatibility, but the
   Agent's durable queue update does not use that stale-snapshot callback.
7. `vitest.config.ts` combines the existing B03, B05 and B06 historical-test
   exclusions without editing the archived tests.

### Vitest exclusion compatibility detail

The `b05HistoricalAudit` / `b06HistoricalQueue` objects are not a broader test
archive policy. They reconcile two inherited contracts that cannot both remain
as the single `test.exclude` property:

- B05's active portable regressions
  `tests/ci/b05-recovery-source.test.ts` and
  `tests/evaluator/b05-evidence-retention-round2.test.ts` literally require the
  text `exclude: [...configDefaults.exclude,
  "tests/evaluator/b05-tcp-readiness-independent.test.ts"]`. The pinned B05
  evaluator test itself cannot be edited because an immutable manifest hashes
  it.
- B07 brings the separate, individually named B03/B06 obsolete-test archive.
  Replacing the B05 array outright made those active B05 regressions fail;
  keeping only the B05 array would execute intentionally frozen old-contract
  tests.

The objects preserve the historical literal while the exported runtime array
is the strict union. Importing the exact candidate config produced only Vitest's
two defaults plus these five individual files:

1. `tests/evaluator/b05-tcp-readiness-independent.test.ts`
2. `tests/cli/b06-batch-failure-queue.test.ts`
3. `tests/evaluator/b03-scope-admission-independent.test.ts`
4. `tests/cli/b06-partial-ack.test.ts`
5. `tests/ci/b06-obsolete-queue-test-archive.test.ts`

There is no glob exclusion. `vitest list` found 1,851 active tests, including
the new combination test and the B03 deadline plus B07 resolution,
versioned-quarantine, multiwriter and private-file successors; none of the five
archived paths appeared. `vitest-runtime-excludes.json`, `vitest-list.txt` and
`vitest-active-exclusion-audit.txt` contain the exact evidence. This is strict
runtime equivalence plus a portable-successor check, not an attempt to suppress
an active failure.

## Combination controls

`tests/cli/b03-b07-queue-combination.test.ts` proves:

- merge retains old and corrected versions of the same ID plus unrelated new
  collection, then exact ACK removes only the selected old version;
- a failing `beforeMutate` guard and a lock timeout leave queue bytes unchanged;
- production replay execution uses the combined durable merge and does not
  delete an already queued correction;
- replay dry-run does not call the normalization-on-read queue path: deliberately
  non-canonical legacy queue bytes remain byte-for-byte unchanged.

Result: 4/4 pass on Node `v22.22.0`.

The exact-candidate focused B03/B07 set passed 78 tests with 3 intentional
skips across 13 test files. It covers replay deadline/scope/privacy, queue
resolution/versioning/private files/multiwriter, frozen prereview negatives and
Agent checkpoint behavior.

## Local verification

All commands used Node `v22.22.0` and npm `10.9.4` on macOS arm64.

| Check | Result |
|---|---|
| Fresh `npm ci` | PASS; 670 packages installed |
| Combination control | PASS, 4/4 |
| Focused B03/B07 set | PASS, 78 passed / 3 skipped |
| Full Vitest, `--maxWorkers=4` | PASS, 1850 passed / 31 skipped, 151 files passed / 12 skipped |
| `npm run verify` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Production dependency audit | 0 vulnerabilities |
| Full dependency audit | 7 high, inherited B02 release condition |

Two default-parallel full-suite attempts at the exact candidate each had only
the unrelated 5-second timeout in
`tests/cli/harness-command.test.ts` while host load average was approximately
25. The same file immediately passed 4/4 alone in 3.39 seconds. A prior full
run before the final dry-run-only test also passed at default parallelism. The
bounded four-worker exact-candidate rerun passed the complete suite. This is
recorded rather than misreported as a clean default-parallel result; exact-SHA
CI remains authoritative for portable concurrency.

The first integration full runs also exposed real compatibility mistakes
(removal of the historical `acknowledged` callback field, loss of B05's static
Vitest exclusion shape, and a homepage mock that double-added old backlog).
Those were corrected before candidate `116a1ff` and the relevant focused tests
were rerun.

## Immutable upstream evidence

- Compared to B03 input `6a030f6`: 88 B03 report/verdict/evidence blobs checked,
  0 mismatches.
- Compared to B07 input `5412876`: 28 B07 report/verdict/evidence blobs checked,
  0 mismatches.
- B07 scoped archived/active test blobs: 16 checked, 0 mismatches.
- B03 historical independent evaluator test and script match their input blobs;
  its four-entry `SHA256SUMS` verifies successfully from repository root.

Historical manifests that pin earlier product source are deliberately not
rewritten to describe the combined source. Their report/evidence bytes remain
immutable; this report has its own manifest.

## Boundaries and remaining gates

This is an experimental combination candidate until the fresh exact-SHA safe
CI run is terminal and independently reviewed. Required external evidence:

- Linux and native Windows jobs, including the B07 real two-process/multiwriter
  control;
- real PostgreSQL 16 B06/B07 partial-ACK and side-effect probes;
- exact-SHA full verify/browser/recovery jobs as configured, with Deploy
  skipped on the non-main branch;
- independent review of the combined queue semantics and archived evidence.

No native Windows or Linux execution and no local real-PG16 probe is claimed in
this report. B03's synchronous filesystem syscall cannot be forcibly cancelled
mid-call; its deadline is enforced before/after bounded stages and immediately
before admission. The seven full-graph npm High findings remain a separate B02
release condition despite a clean production audit. This Generator did not
change `progress.json`, status, the human gate, main, or any remote branch.
