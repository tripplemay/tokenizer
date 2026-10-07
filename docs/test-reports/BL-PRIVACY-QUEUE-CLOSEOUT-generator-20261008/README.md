# F001 Generator handoff (not independent acceptance)

Frozen worktree baseline: `f8449e8` (product baseline `82d6376`).
Batch: `BL-PRIVACY-QUEUE-CLOSEOUT`; owner: Generator; F002 remains evaluator-owned.

## Implementation and compatibility

- `queue.ts` is the sole usage-queue persistence implementation. B03's
  `mergeQueue(events, path, { timeoutMs, beforeMutate })` is re-exported by
  `collect.ts`, including the lock-held pre-write guard. B07 normalization and
  exact version identity are shared by collection, replay, ACK and quarantine.
- Same-ID versions coexist. Identity groups retain their first-seen position
  for legacy ordering without dropping correction versions. ACK deletes only
  normalized versions actually resolved by the response.
- Sync persists each rejected exact version before active queue removal. The
  rowless legacy `invalid_json` fallback narrows batches and requires an empty
  envelope control before quarantining a singleton.
- Existing Agent/CLI acknowledged callbacks remain compatible and idempotent;
  they call the same queue implementation. No second queue writer remains in
  `collect.ts` or `sync.ts`. `agent.ts`, `index.ts` and `replay.ts` are unchanged.
- Atomic queue/quarantine temps use exclusive creation and owner-only modes.
  Owner restriction occurs while the temp is still empty, before private bytes
  are written. Cleanup only removes a temp successfully created by that call.
- B03 physical admission before/after Git, confirmation bindings, bounded
  source reads and the shared Git/replay deadline are unchanged.
- Workflow changes are limited to the B07 PG16 probe selection, environment
  variable and no-skip floor (14 -> 15). No release/deployment gates are removed.

## Inputs and immutable evidence

Product input: selected source/tests from `8bb0b88` + `8cd118e`, manually composed
against the frozen baseline. No wholesale cherry-pick and no read/copy of the
other dirty combination worktree.

`frozen-inputs.json` records SHA-256 hashes derived from fixed Git objects, not
hashes accepted from the current checkout. `audit-frozen-inputs.mjs` compares
each checkout file byte-for-byte with its source object before emitting it:

- 988 existing `docs/test-reports` files and the two specified historical tests
  are pinned to `f8449e8`.
- 19 B03 files are transported byte-identically from `3220837`.
- 16 B07 files are transported byte-identically from `7da2452` (same input
  artifact as the referenced `9486633`).
- Total: 1,025 frozen files. This transport does not convert historical
  FAIL/PARTIAL reports into current acceptance. Their wording and SHA256SUMS
  remain original.

`tests/ci/b07-combination-frozen-inputs.test.ts` verifies all 1,025 content hashes
and their `-text` checkout attributes. B07's original B06 expected hashes are
also retained, not recalculated to bless newline-converted files.

## Archived/excluded tests and successor coverage

Pre-existing exclusions remain:

- `tests/evaluator/b05-tcp-readiness-independent.test.ts`: historical local-Git
  object audit; portable B05 recovery source tests remain active.
- `tests/evaluator/b03-scope-admission-independent.test.ts`: pre-operational
  replay contract; active replay contract/operational/safety tests supersede it.
- `tests/cli/b06-batch-failure-queue.test.ts`: obsolete permanent retry-and-pin
  behavior; B07 resolution/multiprocess suites exercise live-neighbor progress.

Two B07 exclusions are added, without editing either original file:

- `tests/cli/b06-partial-ack.test.ts`: its checkpoint-failure injection runs in
  an observer callback, which now follows the internal durable checkpoint.
  `b07-queue-resolution.test.ts` injects a real atomic queue-write failure in
  `syncEvents`, asserting unchanged accepted/rejected active bytes, durable
  quarantine, no observer notification, and idempotent recovery. Versioned
  quarantine tests additionally retain both same-ID corrections across failure.
- `tests/ci/b06-obsolete-queue-test-archive.test.ts`: hardcodes a singleton
  exclusion list; B07 archive test checks original hashes and explicit successor
  coverage of all original liveness/privacy/failure invariants.

`tests/cli/agent-sync-checkpoint.test.ts`,
`tests/evaluator/bl-homepage-freshness-f002-f003.test.ts`, and the original
`tests/cli/queue-merge.test.ts` remain byte-identical and active.

## Verification environment

See `runtime.json`. Fresh local Node 22.22.0 `npm ci`; `node_modules` did not exist
before install and is not a shared symlink. No dependency/lockfile changes.
The install reported seven high-severity audit findings; no out-of-scope
dependency remediation was attempted.

All test/build invocations use disposable synthetic `HOME`, `USERPROFILE` and
`TMPDIR`. Preliminary checks use `/private/tmp/tokenizer-closeout-20261008-5CSdLv`;
the final sequential runner records its separately generated synthetic root in
`final-command-results.json`. Real process
tests use synthetic files and loopback HTTP. Build uses a deliberately
non-serving loopback PostgreSQL placeholder, not a real database.

The initial focused log records one legacy ordering failure. It was addressed
by preserving identity first-seen order without deduplicating distinct versions;
the original test was not modified. Initial full-test output records two
pre-existing B05 literal-config-format assertion failures; see
`b05-baseline-format.json` for the fixed-baseline evidence.

Coordinator/Planner approved a real `historicalTestConfig` composition on
2026-10-08. Its exclusion array is actually used by the exported configuration;
there is no unused string/comment or additional exclusion to hide either B05
failure. `b07-combination-test-scope.test.ts` imports the real config and checks
the exact effective exclusions and unchanged test inclusion scope. Both B05
tests remain unchanged and active; the initial failing logs remain available.

Default-worker full runs also encountered the unchanged `harness-command` CLI
subprocess test's 5,000 ms timeout; the test passed alone. This does not prove
the failure exists on the frozen baseline or establish its cause. The concurrent full/focused attempt is
explicitly named `pre-adjudication-concurrent`; the later default-worker log is
retained separately. Controlled `--maxWorkers=2` and one final isolated default
worker replay are reported independently. No test threshold or existing harness
test was changed, and a controlled local success is not a default/CI stability
claim. The first sequential runner used a long macOS default temp root and
encountered tsx IPC socket `EADDRINUSE` at 111-byte paths. A separate local
socket-length probe and short-root replay are retained; the runner now uses a
short disposable `/tmp/tk-closeout-*` root on macOS. Product code, old tests and
test timeouts were not changed for either environment issue.

### Observed final commands

| Command / evidence | Observed result |
| --- | --- |
| Fresh Node 22 `npm ci` (`npm-ci.log`) | exit 0; seven high audit findings |
| `npm run lint` (`final-lint.log`) | exit 0 |
| `npm run verify` (`final-verify.log`) | exit 0 |
| Focused suites (`final-focused.log/json`) | 168 passed, 3 Windows-only skipped |
| Full `npm test -- --maxWorkers=2`, short root (`short-root-full-controlled.log/json`) | 1,883 passed, 31 skipped; exit 0 |
| Final default-worker full, long root (`final-full-default.log/json`) | 1,881 passed, 31 skipped, 2 failed: B06 socket collision and harness-command timeout |
| `npm run build` (`final-build.log`) | exit 0; synthetic unreachable DB placeholder |
| Real two-process HTTP (`multiprocess-http.json`) | concurrent collection, same-ID correction, crash/retry and rowless fallback observations |
| Frozen input audit / CI hash control | 1,025 original files byte-identical; original expected hashes retained |

`final-command-results.json` and `short-root-command-results.json` contain
commands, start times, elapsed durations, exit codes and synthetic roots.
`skips.json` lists all 31 actual skipped tests: 16 scratch-database probes,
9 native-Windows cases and 6 external contract-fixture cases. Environment
skips are not execution/acceptance claims. No generated test result is a formal
evaluator verdict.

Reproduce local checks from this worktree with Node 22:

```sh
node docs/test-reports/BL-PRIVACY-QUEUE-CLOSEOUT-generator-20261008/run-local-checks.mjs
TOKENIZER_CHECK_PREFIX=repeat node docs/test-reports/BL-PRIVACY-QUEUE-CLOSEOUT-generator-20261008/run-local-checks.mjs full-controlled
node docs/test-reports/BL-PRIVACY-QUEUE-CLOSEOUT-generator-20261008/audit-frozen-inputs.mjs
```

Do not treat the controlled full success as proof that default concurrency,
native CI, real DB or production is stable. The unchanged harness-command test
timed out in default-worker runs and passed alone; baseline reproducibility
and the cause were not established in this slice.

The staged source/config/test/spec/state diff passes `git diff --cached --check`
when raw report logs are excluded. The unrestricted check reports whitespace in
transported historical logs and captured command output; those bytes are kept
unchanged rather than silently rewriting evidence.

## Boundaries and next owner

- F002 requires fresh different-model-family independent acceptance of the
  exact committed candidate, including spec-lock review and negative controls.
- Native Windows/Linux exact-SHA CI, real PG16, authenticated browser behavior,
  service installer execution, production/fleet and F005 acceptance were not
  performed. Local POSIX file-mode results and byte-policy checks do not prove
  native Windows ACL/runtime behavior.
- No branch was pushed; no deployment or human gate decision was written.
- Queue corruption recovery, other replay source adapters, broader B03 privacy
  work, OpenCode mutable cursors and server-side B08 CAS remain outside this
  bounded composition. No production data or personal sources/queues/configs
  were read, replayed, cleaned or migrated.
