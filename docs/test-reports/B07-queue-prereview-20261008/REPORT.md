# B07 independent queue technical prereview - 2026-10-08

## Outcome: BLOCK

Exact candidate: `4979042e3cf8d2c5f06ed5de13372e49d0bab855`.
This is an isolated, same-family technical prereview, **not formal cross-family
Evaluator acceptance**. Conclusions derive from actual source, fresh synthetic
state, filesystem results and GitHub CI, not Generator report claims.

Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b07-prereview-20261008`.
Read repository rules/T0/T1/current `status=verifying`; no state changed.
Only new tests/fixtures and this report/evidence directory are delivered.
No product edits, push, deployment, or production access. All B03 frozen trees,
reports, commits and logs remain untouched. Dependencies are reused via an
untracked `node_modules` symlink; this is not a clean dependency installation.

## P1 / Q-01: quarantine dedup discards newer same-ID rejected versions

Minimal reproduction:

1. Admit `source=aider, sourceEventId=same-id, inputTokens=1`.
2. Resolve it as rejected; active queue is empty, quarantine stores version 1.
3. Admit corrected same-ID event with `inputTokens=200`; active queue contains it.
4. Resolve the corrected version as rejected.
5. **Actual:** active queue empty; quarantine still contains only tokens=1.
   The corrected exact event version is absent from BOTH durable files.

This is not merely static inference or a simultaneous-write race. The direct
filesystem reproduction also runs as four separate native child processes
under a fresh synthetic HOME, with no config/mock product imports in workers.
`process-negative-and-control.log` records the same permanent local loss.

Root cause:

- `src/cli/queue.ts:24-25,47-55` deliberately preserves distinct minimized full
  event versions even for the same source/ID.
- `src/cli/rejected-events.ts:40-53` still keys by `source + NUL + sourceEventId`
  and keeps the first entry without retaining later differing event versions.
- `src/cli/queue.ts:74-80` treats successful quarantine function return as proof
  of durability, then removes every exact rejected version from the active
  queue, including the version silently skipped by quarantine dedup.

Consequently `syncEvents` can report `rejected=1` even though that rejected
payload is no longer recoverable. No server acceptance is required to cause
this; a controlled, valid-format rejection exercises the documented rejection
paths. The synthetic fixture does not claim its otherwise ordinary token row
would be rejected by a normal production server.

Independent variants:

| Variant | Actual | Result |
| --- | --- | --- |
| Sequential old/new rejection | only old quarantine row, active empty | FAIL |
| Two same-ID versions rejected together | only first quarantine row, both removed | FAIL |
| Actual sync function with partial-ACK response | corrected version removed but not persisted | FAIL |
| Quarantine commits, active write injected failure, then correction/retry | corrected payload lost on retry | FAIL |
| Old B06 rowless invalid_json fallback | good row ACKed, correction reported rejected but absent | FAIL |
| Four separate native processes | corrected payload absent after later rejection | FAIL |

The rowless fallback independently executes request token sequences
`[[200,2],[200],[],[2]]`. The empty envelope succeeds, the singleton is proven
rejected, and a good row later uploads. Result `received=1,rejected=1` still
leaves only the OLD tokens=1 quarantine record. This confirms that correctly
isolating a poison row does not fix quarantine version durability.

Required resolution: quarantine must preserve exact minimized/sanitized event
versions consistently with active-queue version identity, retaining old and
new payloads while deduplicating retries of the SAME version. The active queue
must not remove a rejected version unless that exact version has been made
durable. Simply overwriting the old quarantine row would discard earlier
rejection evidence and would not satisfy the two-version retry controls.

## Passing controls and two-file commit boundary

- Fresh eight simultaneous native writers preserve all eight distinct versions
  of one ID. Exact ACK for tokens=1 leaves seven versions. New state directory
  is POSIX 0700, queue/quarantine are 0600.
- Fresh exact-version old-ACK control retains a corrected version.
- Corrupt quarantine retains active queue and original corrupt bytes.
- Injected queue-write failure after quarantine succeeds leaves the SAME version
  in both files; retry removes active copy and retains one quarantine row.
- Candidate-owned focused suites: **33/33 PASS**, covering native HTTP concurrent
  writes, in-flight kill/retry, old-server narrowing, envelope failure,
  partial-response validation, retry/auth behavior, POSIX owner-only writes and
  legacy queue read permission behavior.

The two files are not atomically committed together. Quarantine-first ordering
can leave a recoverable duplicate after interruption, and the single-version
injected-error control shows logical retry safety. That is different from
Q-01's permanent VERSION loss. The candidate's native crash probe kills a
request in flight, before an ACK arrives; it does not physically SIGKILL in the
quarantine-rename / active-rename gap. Our gap probe uses an injected write
failure, clearly labeled rather than claimed as a power-loss experiment.

Atomic write code uses rename but no fsync of file/directory. This review does
not establish power-loss durability, every stale-lock takeover interleaving,
or Windows ACL correctness for the new independent probes. No unrelated
historical atomic-file implementation was changed to address those limits.

## Exact-candidate CI: FAIL, archive line-ending portability

Independently fetched run
[37669971304](https://github.com/tripplemay/tokenizer/actions/runs/37669971304):
`headSha=4979042e3cf8d2c5f06ed5de13372e49d0bab855`, completed **failure**.
Verify, PostgreSQL 16 and authenticated-browser jobs succeed; Windows fails;
Deploy is skipped. CI green jobs cannot override Q-01's failing negative probes.

Windows job `112958913200` unit results:
**1664 passed / 1 failed / 37 skipped**; files **125 passed / 1 failed / 11 skipped**.
The single failure is `tests/ci/b07-obsolete-queue-test-archive.test.ts` raw-byte
archive hash comparison, not a runtime queue resolution failure.

For `tests/cli/b06-batch-failure-queue.test.ts`, LF hash matches expected
`fb406333cef1b6c8f035c8750a3a7a914da494c0670e2ee7329ff120216b6eca`.
Converting LF to CRLF solely in memory produces
`8e1833440daac3151366f1257505f942724a6446861478cb4170c98ef73c0255`, exactly
the native Windows received hash. `archive-line-ending-probe.json` preserves
this independent reproduction. This identifies checkout newline portability,
not evidence that an agent substantively rewrote the old test. Preserve Git
blob bytes/immutable semantics and make checkout/hash handling portable; do
not change the expected hash merely to accept arbitrary archive mutations.

The native Windows B07 multiwriter test passes in the CI log, but the new
independent same-ID rejection probes were not run there. The Windows gate is
still FAIL, not a full native Windows acceptance of this review's scenarios.

Local `npm run typecheck` exits 2 on reused dependencies: missing Playwright
and two Next cache-signature mismatches, with no added-test diagnostics.
`typecheck.log` / `local-runtime.json` record this environment limitation;
we do not label local L1 green. Exact-candidate CI Verify Typecheck succeeded
with freshly installed dependencies.

## Reproduction and evidence

```sh
npx vitest run tests/cli/b07-prereview-version-negative.test.ts
# 4 passed / 5 failed, including old-server rowless loss
npx vitest run tests/cli/b07-prereview-process.test.ts
# 1 passed / 1 failed, fresh native processes and 8-writer control
npx vitest run tests/cli/b07-queue-resolution.test.ts tests/cli/b07-queue-multiwriter.test.ts tests/cli/b07-private-queue-files.test.ts tests/cli/b06-rejected-events-concurrency.test.ts tests/cli/agent-sync-checkpoint.test.ts tests/cli/sync-retry.test.ts
# 33 passed
gh run view 37669971304 --json headSha,headBranch,event,status,conclusion,url,jobs
gh run view 37669971304 --job 112958913200 --log
```

`evidence/version-negative.log` retains the FIRST 3-pass/4-fail probe run;
`version-and-rowless-negative.log` records expanded 4-pass/5-fail controls.
Native process, focused, CI, typecheck and runtime snapshots are separate raw
artifacts, with SHA-256 manifest. Tests recreate/reset synthetic state on each
run and retain failing safety assertions. Obtain a successor exact SHA and
rerun these frozen controls before formal cross-family signoff.
