# F002 remains pending: cleanup ownership proof is unavailable

Generator implementation decision under the locked scope, not an acceptance.
`src/cli/bounded-subprocess-worker.mjs` is deliberately unchanged.

Actual source:
- The only owned process identifier is `child.pid` from a plain Windows spawn
  with `detached:false`; no authoritative descendant-ownership handle is kept.
- `killTree()` requests taskkill `/pid <child.pid> /T /F`, and records success
  only for taskkill close status0. A failed spawn, watchdog or any nonzero
  status stays unsuccessful.
- `closed` is set by the direct child's close event. Local stream destruction
  is not proof that arbitrary descendants have exited or relinquished handles.
- `finish()` maps non-ok results to supervision when `killTree()` returns false.
  Preserving this behavior prevents a failed/unknown cleanup from being
  silently downgraded to an output-only error.

Read original native artifacts in sibling diagnostic-ci worktree, run37808814119:
`subprocess.trace.jsonl` lines57-64 records worker6920 receiving600 stdout+600
stderr, launching taskkill5640 against child884, direct child exit/close0 before
taskkill exit/close128, then workerKind supervision. `subprocess.json` separately
records combined1024 supervision and combined1200 successful600/600 bytes.
The trace does not establish taskkill128 semantics or authoritative owned-tree
completion. The bounded wrapper exposes no additional ownership evidence.

Inherited-pipes observations of the two fixture-recorded PIDs dead at return
and+100ms are retained, but are not arbitrary-descendant or automatic Job Object
proof. Parent hooks/three replay timer cases were not reached in the original
supporting diagnostic and are not guessed or repaired here.

A narrow safe proof cannot be derived from this plain PID/stdio contract. Adding
Job Objects, process-tree enumeration/ownership or a worker architecture would
exceed this spec. Checking child exitCode/close + streams destroyed, treating128
as already gone, changing public error inheritance, or ignoring killer nonzero
would violate the locked strict condition. None is implemented.

F002 therefore remains pending with its original caps, deadlines, worker,
subprocess wrapper, old tests/fixtures and public error hierarchy unchanged.
W07 is not claimed fixed. W02/W03/W05/W06/W08 remain unresolved. Any later repair
needs separately adjudicated narrow ownership evidence and native reproduction;
this batch cannot become done or release-ready by local positive tests.
