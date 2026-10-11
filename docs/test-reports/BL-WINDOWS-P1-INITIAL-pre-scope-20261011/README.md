# Windows P1 INITIAL: independent pre-scope review

**BLOCKED: one specification cross-field blocker (B001).** This is a supporting
section 1.5 review, not a functional Evaluator result or product failure.
`release_ready=false`, `implementation_authorized=false`,
`publication_authorized=false`, `native_execution_authorized=false`.

Reviewed exact commit `c58434f9791b944c0414b83830bc1ea412aa1b2d` in the isolated
`tokenizer-windows-p1-initial-scope-20261011` worktree. Its diff from planning base
`93a61ba69504d6e9c1eee803c5ee4e2750c54640` adds only the two binding documents.
The three proposed implementation paths do not exist; that is not a code failure.
The original proposal, independent scope verdict and frozen runtime sources were
read as artifacts, not replaced or treated as implementation approval.

## B001: the clean native outcome relation is not fully bound

`BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json:110-114,162-164` allows this tuple:

```json
{"outcome":"refused","status":1,"signal":null,"errorName":"BoundedSubprocessLaunchError","errorCode":"EIO","elapsedMs":1,"workerKind":"ok"}
```

An offline schema check accepts it. It also satisfies the only explicit refused
antecedent (`workerKind=ok`, nonzero safe status). A normal `ok` return from the
frozen `runBoundedSubprocess` does not also throw `BoundedSubprocessLaunchError`.
With a clean T1 empty prefix or T2 `json-enter`-only prefix, the written progression
antecedent otherwise matches. The prose statement that launch outcomes never
admit progression does not explicitly settle an error-class/outcome conflict.
No claim is made about a nonexistent implemented validator accepting it.

There is also no explicit equality binding between a normal `ok` native
status/signal and the uniquely admitted PowerShell child's exit/close facts.
For example, native `refused/status=1` with null error fields is not explicitly
rejected when the admitted native close reports `status=0/signal=null`.
Reconciliation with old trace `spawn-sync.workerKind=ok` alone cannot close this:
its status/signal describes the **Node worker**, not the native child.

Minimum closure must be made by Planner, not chosen by Generator:

- Normal `ok` return used as completed/clean refused: no error class/code; clean
  refused requires nonzero safe status and null signal. Contradictory or missing
  facts must be unknown and stop progression.
- Normal native return status/signal: reconcile with the admitted live handle's
  existing guard/trace native child-exit/child-close facts, bound by child PID,
  worker ownership and fixed case/script identity.
- Throw/non-return paths: do not invent product return metadata. The current
  schema accepts a timeout tuple with `status=0,errorCode=EIO`, although the frozen
  timeout API returns no status/signal/code. Bind unavailable product return
  fields to null/unknown; separately observed close/EOF/health may be checked for
  consistency, never inferred from an error class. No worker patch, additional
  timeout output, host query or native query is requested.
- Exercise these contradictory tuples at T1/T2 selection boundaries in future
  mocked controls after the revised specification is independently reviewed.

Sources: `src/cli/bounded-subprocess.ts:83-111`;
`src/cli/bounded-subprocess-worker.mjs:52-57,84-89`;
`native-runtime-parity.mjs:84-110,238-245`;
`trace-preload.mjs:69-70,75-85`, both under
`docs/test-reports/windows-release-diagnosis-20261008/`.

## Narrow bindings that remain coherent, not authorized

- Exactly three new implementation paths, only T0-T3, at most four single smoke
  admissions, unchanged E0 key set and timers/caps/cleanup. T1 is byte-exact old
  P1; T2 inserts only the JSON writer pair; T3 inserts only the bracketed
  lookup-or-autoload operation. No T4/T5 executable selector, modules, arms, P2,
  downstream, command/environment repair or retries.
- Guard-before-trace can attach additive Buffer listeners before returning the
  admitted native handle. Worker-process synchronous stage persistence avoids
  losing timeout prefixes without changing worker stdout/result/protocol.
  Parser, EOF, health, provenance and cleanup uncertainty remain independent.
- The strict append design is implementable in principle: exact-path wrapper
  installed before old trace captures it, saved pre-trace primitives, atomic
  mkdir locks, same-transaction counter admission, inclusive combined append
  caps and immediate failure on contention/partial write/release failure. Actual
  diff must prove every permitted writer is gated and failed health persists;
  old unlocked pre-checks alone do not prove a hard cap. No implementation,
  contention, perturbation or native test was performed.
- T1 success stops immediately; T1 clean empty refusal/timeout alone admits T2;
  T2 clean `json-enter`-only refusal/timeout alone admits T3; T3 is terminal.
  Unknown EOF/identity/health cannot be overridden by markers or fabricated skips.
- Fixed non-main push/event/ref, `contents:read`, `${{ github.sha }}` checkout/HEAD
  equality and no persisted checkout credentials, Secrets or environment.
  Explicit 16-file sealed upload, 15 manifest entries and 11-source binding set;
  validated JSONL rebuilding only, no raw/glob/directory/scratch fallback.

## Actual checks

1. `git status --short --branch`, `git rev-parse HEAD`, exact commit stat and
   name-status diff: clean starting worktree, exact SHA, only two added documents.
   `git diff --check <planning-base> <source-commit>` exited 0.
2. Offline Node builtins-only JSON/script/hash assertions: all 10 referenced
   input hashes and three existing findings metadata hashes matched; all four
   script hashes, byte-exact T1 and T2/T3 single deltas matched; pending line 29
   bytes; 49 local schema refs resolved; 15 object schemas have exact required
   keys; frozen safe code/signal/abort enums and 22 synthetic keys matched.
3. Static fixed-path/argv/environment/budget/workflow/lock/upload assertions:
   three future paths absent; source set 11, upload set 16, manifest set 15;
   fixed controls and all false authority flags matched.
4. Pure JSON schema subset evaluation accepted both B001 tuples and comparison
   to the written cross-field antecedents exposed the missing relation. This is
   specification analysis, not a probe, product test or functional FAIL.
5. `checksSummary.passed/failed/skipped` reject null. Missing/crashed test reports
   must fail sealing rather than fabricate zero counts; `exitCode=null` alone
   does not establish counts. This is a future implementation control, not an
   additional blocker in absent code.

The report JSON contains exact document SHA-256/size bindings, evidence paths,
the counterexamples and the performed/not-performed boundary. The prior
59-file/9-hash original native inventory was not re-reviewed or re-authenticated;
only its referenced metadata hashes and current direct source/input hashes were
checked. Historical run identity is not this candidate's execution identity.

No native/probe/functional execution, network, CI, SSH, Secrets, installation,
push or production action occurred. No product/source/test/workflow/original,
state/harness/memory or human gate field was changed. Only this README and
`verdict.json` are reviewer outputs.

## Next step

Return B001 to Planner for the minimum explicit relation closure, then perform a
fresh exact-document pre-scope review. Coordinator still owns separate scope,
implementation and publication authority. Actual-diff review, synthetic controls,
different-model-family functional acceptance and release gates remain unperformed.
