# B03 round2 independent technical prereview - 2026-10-08

## Outcome: BLOCK

Exact candidate: `d20da68391b4cde73e4b29a5385c7dc3fbbeddef`.
Fresh-context-derived same-family technical rereview, **not formal cross-family
Evaluator acceptance**. The original round1 report and 7-pass/2-fail baseline
remain immutable at `ac6994ace04e0614b17f41261a704ff8b883f823`.

**Round1 privacy blockers and requested confirmation-drift controls now PASS.**
However, replay has no effective elapsed-time hard bound through Git enrichment
and final admission; a new timed child probe fails. Exact-candidate native
Windows CI also fails two rejection-message assertions. Neither is hidden by
the passing scoped macOS tests.

Detached isolated worktree:
`/Volumes/ORICO/project/.worktrees/tokenizer-b03-round2-prereview-20261008`.
Only new/copied tests and this new report/evidence directory are delivered.
No product edits, state-machine writes, pushes, deployment, or production calls.
Dependencies are reused via an untracked `node_modules` symlink.

Local `npm run typecheck` exits 2 because reused dependencies lack
`@playwright/test` and expose two Next cache API signature mismatches. Raw
output and installed-version snapshot are in `typecheck.log` / `local-runtime.json`.
No errors name the added prereview tests. This environment check is NOT reported
as local L1 PASS; the exact-candidate CI Verify job separately passed Typecheck
with its freshly installed dependencies.

## Verified closed controls

The two original test files were imported byte-for-byte from `ac6994a`; their
matching SHA-256 values are in `evidence/frozen-test-hashes.txt`.

- Original independent suite: **9/9 PASS**, including source parent identity,
  FIFO writer-free refusal, config/projectRoots confirmation, source dots,
  file growth, dot workspace exclusion and excluded Git symlink target.
- Original ordinary CLI collect negatives: **2/2 PASS**. Actual fresh HOME CLI
  subprocesses report `Collected 0 events`, with empty durable queues for both
  dot and Git alias cases. Replay reports `wouldAdmit=0` / `admitted=0`.
- Candidate focused suites under unchanged default macOS TMPDIR:
  **77 PASS / 1 Windows-only SKIP**. Combined with original probes:
  **88 PASS / 1 SKIP**. The original `/var` fixture false negatives are fixed;
  FIFO evidence still contains `FIFO_CREATED` before safe refusal.
- Fresh independent round2 confirmation/path tests: **12/12 PASS**; candidate
  scope-safety tests: **13/13 PASS**. These cover alias retarget 0-to-1 before
  execute AND during final config reread, unchanged count/different admitted
  event, unchanged wire payload/different physical target, and unchanged
  count/IDs/different enrichment payload. All stale executions avoid merge.
- Existing CLI lifecycle tests preserve future-only rule semantics, cursor and
  admitted backlog retention, paused behavior, zero network in configure, and
  next-sync automatic upload without scope-fingerprint wire leakage.

Complete candidate payload binding is exercised using controlled enrichment
injection. It proves the confirmation code detects changed candidates; it does
not claim live Git metadata caches always refresh or that every ABA race is
eliminated.

## New P1 / R2-01 BLOCK: elapsed budget does not bound replay execution

### Real wall-clock dry-run negative

`tests/cli/b03-round2-elapsed-negative.test.ts` launches a fresh process with
a synthetic PATH Git fixture that records entry, stalls for 12 seconds, then
exits. The JSONL is a small physical regular file with one admissible row. The
outer 11-second watchdog terminates the replay process:

```text
elapsedMs=11010, errorCode=ETIMEDOUT, status=null
stdout=REPLAY_STARTED
```

No replay refusal or completion occurs within its declared 10000 ms inspection
budget. The safety expectation remains FAIL in `evidence/elapsed-negative.log`.
This is a controlled subprocess stall, not a claim about usual local Git speed.

Root cause: `src/cli/git.ts:16-20` invokes synchronous `execFileSync("git", ...)`
without timeout. `inspectReplay` now performs that enrichment during dry-run,
then checks Date.now only AFTER enrichment returns. A never-returning Git call
prevents the guard from executing. This new dry-run exposure is absent from
round1's preview pipeline (which did not enrich).

### Final admission negative

`tests/cli/b03-round2-final-deadline-negative.test.ts` independently advances the
clock by 11000 ms during execute's SECOND enrichment, leaving events and digest
inputs unchanged. This is a deterministic virtual-clock control, not a second
wall-clock measurement. Execute still returns `admitted=1`, `mergeCalled=1`.
The deadline-refusal expectation FAILS in `evidence/final-deadline-negative.log`.

There is no elapsed check around final enrichment / physical fingerprint /
merge in `executeBoundedReplay`. Each `readBoundedReplayFile` starts a fresh
10-second timer; no single deadline is propagated across inspect, config
reread, confirmation read, enrichment, canonicalization, and queue lock/merge.
`physicalScopePath` calls synchronous realpath/lstat repeatedly without a
deadline; foreign-host native UNC/network filesystem resolution could block
inside those calls. That last scenario is **source-derived risk, not a live
Windows or UNC timing measurement**. The finite file/FIFO tests do not prove a
hard syscall wall-clock cap.

Required resolution: a bounded worker/process (or another interruptible design)
with a shared overall deadline, subprocess timeout, and refusal before any
admission on deadline violation. Do not silently drop stalled enrichment and
admit after deadline merely to make the probe green. Do not assert a universal
10000 ms wall-clock guarantee while synchronous filesystem calls lack an
interruptible boundary.

## Physical scope / Windows / nonexistent-path review

Live macOS controls:

- Ordinary nonexistent descendants resolve the deepest existing ancestor and
  retain original event identity/path bytes. They can be admitted beneath an
  allowed physical ancestor; nonexistent is not automatically denied.
- Nonexistent descendants of an alias into excluded/outside scope are denied.
- Broken links, broken-link descendants and broken rule roots deny; ELOOP and
  ENOTDIR deny for both event and scope-root inputs.
- Explicit dot components deny. Every event path must satisfy an include;
  excludes have precedence across both workspace fields.
- Foreign Windows-drive and backslash UNC paths on macOS intentionally use
  normalized lexical comparisons, not physical resolution. Case, separator,
  sibling-prefix and dot controls PASS. An allowed foreign nonexistent path is
  accepted lexically, with its original bytes untouched. This is **not a
  physical fail-closed guarantee for foreign paths**.

Source-source distinction: replay SOURCE filenames still reject Windows
UNC/device/ADS and parent reparse points. Privacy WORKSPACE canonicalization
does not apply that source's drive-only rule: native Windows UNC workspace/rule
paths may reach realpathSync. Static review alone cannot certify reparse tags,
UNC reachability/timeouts, ADS aliases or native missing-path error mappings.

No new round2 independent tests were executed on a native Windows host. Remote
exact-candidate native CI is separately reviewed below and remains FAIL.

## Independently inspected CI evidence

Run [37668575390](https://github.com/tripplemay/tokenizer/actions/runs/37668575390)
is `workflow_dispatch`, branch `codex/b03-replay-round2-ci-20261008`, exact
`headSha=d20da68391b4cde73e4b29a5385c7dc3fbbeddef`, completed **failure**.
`ci-run-latest.json` was read from GitHub rather than implementer narration.

- Verify / PostgreSQL 16 / authenticated browser jobs: success.
- Deploy: skipped. This is not a production acceptance or deployment.
- Windows job `112954122753`: failure. Its raw log is archived as
  `evidence/ci-windows.log`. Native pinned-installer fixture separately passes.
- Native Windows unit result: **1623 passed / 2 failed / 34 skipped**;
  files **126 passed / 1 failed / 8 skipped**.

The two errors are rejection-message test mismatches, not observed unsafe
admission:

1. R1 parent replacement at `afterRead` expects `non-symlink directory`, but
   receives `Replay refused: source could not be opened safely`. The generic
   catch also wraps a failing test-hook setup operation. Without hook-stage
   markers, the log does NOT establish that rename+junction setup completed;
   add staged mutation evidence before counting this adversarial race as proved.
2. Windows network/device/ADS loop expects `local Windows drive file`, but
   receives `source requires an absolute path without dot traversal`. Source
   review shows device path `\\.\pipe\...` contains a literal dot and can
   legitimately hit that earlier rejection. A failed loop assertion prevents
   subsequent cases from completing; therefore do NOT report every ADS/UNC case
   as independently exercised. Use per-case refusal/no-open controls.

Preserve the safe refusal and fix assertions/instrumentation. The native Windows
gate is not PASS merely because the errors plausibly arise from fail-closed
branches.

## Reproduction and immutable evidence

```sh
npx vitest run tests/cli/b03-fixed-prereview-independent.test.ts tests/cli/b03-fixed-collect-privacy-negative.test.ts tests/cli/replay-safety-regression.test.ts tests/cli/replay.test.ts tests/cli/replay-operational-contract.test.ts tests/cli/replay-contract.test.ts tests/cli/replay-help.test.ts tests/cli/privacy-admission-cli.test.ts tests/cli/privacy.test.ts tests/cli/queue-merge.test.ts
# default TMPDIR, 88 passed / 1 skipped
npx vitest run tests/cli/b03-round2-independent.test.ts tests/cli/privacy-scope-safety.test.ts
# 25 passed
npx vitest run tests/cli/b03-round2-elapsed-negative.test.ts
# 1 failed, real subprocess watchdog at 11010 ms
npx vitest run tests/cli/b03-round2-final-deadline-negative.test.ts
# 1 failed, virtual-clock final merge after 11000 ms
gh run view 37668575390 --json headSha,headBranch,event,status,conclusion,url,jobs
gh run view 37668575390 --job 112954122753 --log
```

Raw logs and snapshots are in `evidence/`; their hashes are in `SHA256SUMS`.
The original round1 worktree/report was neither edited nor amended. Generator
must provide a successor exact SHA for elapsed-budget and native Windows
gate fixes, followed by fresh independent technical replay and formal
cross-family acceptance. This report cannot authorize B03 closeout or release.
