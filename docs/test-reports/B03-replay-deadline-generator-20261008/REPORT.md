# B03 replay deadline narrow fix - Generator handoff

Date: 2026-10-08

## Scope and outcome

This is a Generator handoff, not an independent evaluator verdict or release
approval. The implementation was produced in an isolated worktree from exact
base `d20da68391b4cde73e4b29a5385c7dc3fbbeddef`.

Product candidate: `ade94c914fadb6efb5aea7e3b74c1bea4efa5fd3`.

The candidate closes the two blockers recorded in the immutable round2
technical prereview at `3220837`:

- replay Git enrichment is now interruptible and refuses before the operation's
  10000 ms deadline;
- preview and execute each use one absolute deadline through source inspection,
  bounded read, parsing/scope checks, Git enrichment, final config/file/binding
  confirmation, queue-lock acquisition and the final mutation guard;
- the execute path does not merge after the budget expires;
- native-Windows regression assertions now distinguish safe rejection from
  proof that the adversarial rename/junction setup actually completed, and run
  UNC, device and ADS cases independently.

No normal collection caller opts into the replay deadline. Existing event
identity behavior is unchanged. No old evaluator/prereview evidence, product
state, human gate, branch remote or production environment was modified.

## Implementation

### Interruptible Git enrichment

`src/cli/git.ts` accepts an optional absolute `deadlineMs`. Replay supplies it;
ordinary collection does not. Every replay Git subprocess receives a timeout
derived from the remaining operation budget. A 2000 ms termination/propagation
margin keeps child termination and refusal inside the public 10000 ms bound.
Timeout, kill, signal or elapsed-deadline outcomes fail closed instead of being
treated as an ordinary missing Git result.

The margin was increased from 1000 ms after a local exact-commit probe exposed
a scheduling-dependent 10144 ms outer wall-clock result. The Node 22 successor
probe completed in 8253 ms, the exact frozen prereview negative in 8376 ms, and the
Node 22 full-suite run in 8847 ms. This preserves a real timing assertion rather
than weakening it.

### One operation deadline and reject-before-write

`src/cli/replay.ts` establishes one absolute deadline for a dry-run and one for
an execute invocation. It passes that same value through all replay stages,
including both execute enrichments and the confirmation reread. Deadline checks
run after synchronous stages and immediately before queue admission.

The production queue merge receives only the remaining lock timeout.
`mergeQueue` also runs a replay-supplied `beforeMutate` guard while holding the
queue lock, after reading/merging the current durable queue but before the
atomic write. A focused test proves a final guard failure leaves the queue
byte-identical.

### Native-Windows assertion repair

The parent replacement test records `not-started`, `started`, `renamed` and
`linked` stages. It requires a race-specific rejection only when the link was
actually installed. If Windows rejects rename while the leaf handle is open,
the test requires the observed generic fail-closed refusal and does not claim
the junction race ran.

UNC, device and alternate-stream inputs are independent parameterized cases.
The device spelling may correctly hit the earlier dot-traversal check; each case
must still refuse before opening. This changes test claims, not the source-path
policy.

## Verification on exact product candidate

Runtime: macOS, default `TMPDIR`, Node `v22.22.0` selected explicitly.

- New deadline successor suite: **4/4 PASS**. Real stalled Git child returned
  fail-closed in 8253 ms in the Node 22 focused run.
- Exact prereview negatives copied from commit `3220837` into an ephemeral tree:
  **2/2 PASS**. The real Git negative reported `elapsedMs=8376`, `status=0`,
  `REPLAY_REFUSED Replay refused: Git enrichment exceeded 10000ms deadline`.
  The deterministic final-admission negative refused instead of merging.
- Full Vitest: **1639 passed / 26 skipped / 0 failed** across 127 passed and 9
  skipped files. The new real child case completed in 8847 ms.
- `npm run verify`: PASS (`prisma generate && tsc --noEmit`).
- `npm run lint`: PASS with zero warnings.
- `npm run build`: PASS; Next.js production build completed.
- `git diff --check`: PASS.

An accidental full-suite invocation under the machine-default Node v25 failed
six `better-sqlite3` loads because `node_modules` was installed for Node 22
(`NODE_MODULE_VERSION 127` versus required 141). It was rerun with the required
Node 22 runtime and passed fully. This is an environment mismatch, not counted
as candidate evidence.

Commands and concise outputs are preserved in `evidence/test-results.txt`.

## Boundaries and remaining gates

- The implementation cannot preempt an individual synchronous kernel filesystem
  call (`lstat`, `realpath`, `open`, `read`) that never returns. It checks the
  shared deadline after each synchronous stage and prevents mutation after
  expiry, while the Git subprocess itself is actively timeout-bound. Therefore
  this handoff does not claim a universal 10-second wall-clock cap for a wedged
  filesystem syscall.
- The injected `mergeEvents` option is a unit-test seam. Production execution
  uses the deadline-aware locked `mergeQueue`; external custom injections are
  not a supported durable queue path.
- No native Windows execution occurred locally. A fresh exact-SHA safe-branch
  CI run must prove the repaired Windows cases, Node 22 Verify/full suite and
  Deploy skipped before evaluation.
- This same-family Generator evidence cannot close B03. Fresh independent
  evaluation remains required, along with all broader B03 release gates.

## Commits

- `16ee8de762812fe278573f6eb78fda784003f90f` - shared replay deadline,
  reject-before-write guard, Windows assertion portability and successor tests.
- `ade94c914fadb6efb5aea7e3b74c1bea4efa5fd3` - reserve sufficient real Git
  termination/propagation budget after the first timing probe caught an overrun.
