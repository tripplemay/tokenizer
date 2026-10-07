# B03 durable admission and future bounded replay contract

Isolated upgrade slice based on `ecdd354`, not the historical F005 batch.
Coordinator-approved scope: durable admission + backlog disclosure now;
operational bounded replay is deferred to a separate R07 slice.

## Accepted product semantics

1. `local-only` collects minimized admitted events into the existing durable
   queue. Switching to `sync` does not upload inside `configure`; it enables
   automatic backlog upload at the next Agent/run/sync cycle. Show the backlog
   event count and this timing in CLI configuration/status output.
2. Include/exclude rules govern admission of newly collected events, not deletion
   or suppression of already-admitted queued history. Legacy durable queue rows
   are treated as already admitted. Continue Git/raw-payload minimization.
3. Rule edits do not reset parser cursors or replay previously excluded history.
   Both `run`/Agent and `collect` use the existing incremental cursor. Preview
   remains read-only and is not historical admission. Paused `collect` returns
   before reading/writing cursors or writing the queue.
4. Upload mode still gates usage/heartbeat/network calls. Pausing cannot revoke
   a request already in flight; this slice adds no cancellation guarantee.

## Admission/epoch design

The existing queue is the admission record. Do not retrofit current scope rules
onto it and do not pretend legacy records have a known collection policy.
`collectionScopeFingerprint` hashes only canonical, sorted include/exclude
lists, not upload mode. It labels the last incremental collection in local
state and the current scope in CLI status; it is NOT a per-record epoch or an
upload authorization token. It never changes event IDs, canonical Codex IDs,
queue format, parser cursor fields, or wire identity. No cursor is compared to
that fingerprint and no rule change can trigger a cursor rewind through it.

`syncEvents` accepts already-admitted inputs. Collection callers must use
`collectEvents`, which applies path rules before admission. Wire batching still
applies minimization and Git sanitization. Queue ACK/concurrent-writer races,
queue corruption recovery, and per-event provenance are not redesigned here;
those remain separate data-reliability scope. No historical server rows change.

## R07 interface: non-executing contract in this slice

`planBoundedReplay` validates an immutable request/plan only. It performs NO file
reads, parser calls, queue/cursor writes, or networking. There is NO `replay`
CLI and no usable historical rescan/dry-run implementation in this slice.
An attempted `tokenizer replay ...` fails as an unknown command.

Initial planned R07 adapter scope is one Claude project JSONL file. Other sources
must be explicitly implemented and reviewed, never silently delegated to normal
source discovery. The plan contract requires:

```ts
{
  source: "claude-code",
  file: "/absolute/literal/session.jsonl",
  from: "2026-10-01T00:00:00.000Z", // inclusive
  to: "2026-10-02T00:00:00.000Z",   // exclusive, at most 31 days
  maxBytes: 1000000,                // explicit, at most 16 MiB
  maxEvents: 100,                  // explicit, at most 5000
  dryRun: true                    // default; execution unsupported here
}
```

The returned frozen plan adds `maxFiles: 1`. A caller-supplied `maxFiles` is
an unknown option and is rejected; the request cannot widen the file scope.

Missing limits/range/file, roots/directories without a literal JSONL file,
relative paths, globs, unknown recursive/home-root options, unsupported sources,
noncanonical UTC, invalid/excess budgets, and execution requests fail closed.
These are interface negative tests, not evidence of an operational adapter.

## Required R07 implementation guardrails

- CLI requires source + one explicit absolute file + UTC range + byte/event
  budgets; defaults to dry-run. No default HOME, project root, glob, directory,
  `all`, recursive walk, or implicit cursor deletion. Never implement this by
  calling home-wide `collectEvents` without a cursor, changing HOME/root, or
  clearing production cursors.
- Validate and open a regular file without following symlinks/reparse points;
  verify handle identity and read at most the byte budget plus one detection
  byte. A directory named `*.jsonl`, a growing file, and a file replaced between
  stat/open are required negatives. Preflight `stat.size` alone is insufficient.
  Reject an exceeded byte/event/record budget without silently truncating or
  admitting a partial replay. Bound physical records/line bytes as well as
  emitted events, memory, elapsed time, and warning/sample output.
- Add a parser explicit-file/buffer adapter retaining the ORIGINAL source path
  and mtime for existing identity/fallback semantics. Do not invent a temporary
  path that changes sourceEventId; do not fall back to directory discovery.
  Preserve Claude corrections and Codex cumulative identity when their adapters
  are later supported. Required adapter tests prove no `walk`/unselected file
  opens occur and IDs equal the ordinary parser's IDs for the same source.
- Dry-run returns only minimized aggregate counts plus a tightly capped optional
  safe sample. It changes no queue/cursor/config/state and sends no network
  request. Enforce source/time/rule budgets before displaying any sample.
- Execution is a separate explicit opt-in, confirming a plan digest that binds
  source file identity/content, UTC window, budgets, and collection-scope
  fingerprint. A changed file/scope/mode invalidates that confirmation.
  Paused mode rejects execution. Admit only events matching the current scope;
  merge idempotently into the existing admitted queue without rewriting normal
  cursors. Report selected/filtered/admitted counts and the total resulting
  backlog. Explain that sync-mode backlog uploads at the next Agent/sync cycle.
- Test abort/crash and concurrent normal collection so a failed replay never
  loses old backlog or advances the normal cursor. Existing admitted backlog is
  never retroactively filtered even when replay's new admission rules differ.

## Independent acceptance / exclusions

Evaluator must inspect the actual diff and independently test mode transitions,
changed rules with old admitted backlog, incremental CLI collection after a
previously excluded record, exact cursor preservation on configure, fingerprint
absence from wire, paused collection, failed uploads, and replay fail-closed.

Not a complete B03 closeout: R07 adapters/CLI, raw diagnostic opt-in with expiry,
versioned path-containing identity migration, live multi-tenant canary/fleet
rollout, and historical production cleanup remain separate. Historical cleanup
requires user-approved backup/restore and bounded migration; none is performed.
