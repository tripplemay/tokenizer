# Instrumentation semantics revision

This additive follow-up preserves original commit
`ec7b439893f4e2c1d0b6de8b1943f1a38860e70b`, its CI evidence, source hashes,
diagnosis/schema, README conclusions and local-check artifact unchanged. Only
the two new diagnostic scripts are revised. Product, original tests, release
workflow, status files, production, credentials and human gates are untouched.

## Defect and minimum correction

The initial logger's synchronous stat/append could throw from inside a native
success/error wrapper and replace the original return or exception. Its ordinary
child `error` listener could also consume an otherwise unhandled EventEmitter
error. These are instrumentation defects, not new evidence of product defects.

- Logger stat, append and serialization now execute within a catch-all boundary.
  Failed logging cannot throw into the native API wrapper or its event callback.
  The original API is called once, its result returned, and its exception
  rethrown unchanged. Trace limit is an explicit instrumentation failure.
- Child launch-error observation uses `events.errorMonitor`, not a normal
  `error` listener. It does not handle the original error. Existing product error
  handlers and unhandled-error process termination remain in force.
- Every Node preload starts a private health sidecar in the owned synthetic
  root as `pending`. A logger failure attempts `failed` with only an allowlisted
  reason code; sidecar-write failures are caught as well. Only normal process
  exit with no instrumentation failure writes `complete`.
- The independent diagnostic parent checks its directly spawned PID and Node
  PIDs observed in spawn/worker/preload records against health sidecars. Missing,
  pending, failed, invalid, unreadable or malformed trace/health data all make
  `diagnosticCompleted=false`. A failed marker write cannot silently turn an
  uncompleted initial sidecar into complete. Complete describes logger health
  through the preload's exit callback, not a native process/cleanup verdict.

## Conservative completeness boundary

Expected forced termination may not run Node's exit handler. Its sidecar remains
pending. This deliberately yields `traceCompletenessUnknown=true` and diagnostic
nonzero, even if product timeout/tree cleanup was correct. **It is not a product
cleanup failure, safety verdict or release gate.** Original worker results,
native filesystem errors, PID liveness and trace bytes remain unchanged.
Unknown/failed instrumentation must not be mistaken for complete runtime proof.

This is conservative by construction: if a child exits before registering its
preload, or is killed midway through logging, evidence completeness is unknown.
No untrusted stale PID is signalled to make completeness appear green. The
original bounded cleanup/canary contract still applies.

New allowlisted output per case: `<case>.trace-health.json`. It contains only
expected PIDs, `pid/state/reasonCode` entries, missing/invalid flags, read-failure
codes and completeness flags. No environment, command line, secret, content or
raw stream bytes. Existing JSON/JSONL upload allowlist includes these files;
workflow Generator was notified. Do not upload the temporary synthetic tree.

## Local verification, not native Windows validation

Run from the diagnosis worktree:

```sh
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node docs/test-reports/windows-release-diagnosis-20261008/revision-checks.mjs
```

`revision-local-checks.json` records Node 22.22.0 on darwin, syntax checks,
unchanged diagnosis schema/source/evidence hashes, revised instrumentation
hashes and four synthetic logger-only controls:

1. Healthy trace returns native success, preserves ENOENT, sidecar complete.
2. Logger stat EIO still returns native success and preserves original ENOENT,
   sidecar failed.
3. Logger append EIO has the same preservation and failed status.
4. Missing child executable without a product error listener remains an unhandled
   error and exits nonzero; errorMonitor does not consume it.

These controls execute no product module or Windows diagnostic case. They verify
instrumentation semantics only. All four controls, three syntax checks, schema
validation and source/evidence hashes passed. The original Windows run remains
failed and F004/release_ready unchanged. Native execution and scope-critic review
are still required before using these diagnostic artifacts as branch evidence.
