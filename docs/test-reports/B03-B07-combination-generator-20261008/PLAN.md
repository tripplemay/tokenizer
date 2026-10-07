# B03 + B07 combination plan

Date: 2026-10-08

Base: `872ba3634d7c345dba33c32d57bd2f5773b6ca0a`

Inputs:

- B03 replay/deadline handoff: `6a030f6a3099684058cd5caed049f943cf03ab9a`
- B07 versioned queue/quarantine handoff: `541287603bf3ee41d1d86adde8328d2f9b3ae437`

This is a Generator combination plan, not an evaluator verdict. Upstream reports,
verdicts and frozen negative evidence must be transported byte-for-byte. The
integration state, progress and human gate are out of scope.

## Conflict and risk inventory

1. B03 implements `mergeQueue(events, path, { timeoutMs, beforeMutate })` in
   `collect.ts`. Replay depends on the custom path for tests, the remaining
   deadline as lock timeout, and a guard under the lock immediately before the
   atomic write.
2. B07 moves queue ownership into `queue.ts` and exposes
   `mergeQueueEvents(events)` only for the global queue. A direct B07 overwrite
   would remove B03's replay API and deadline guard.
3. B03 merge deduplicates by source and event ID. B07 requires exact normalized
   event-version identity so a concurrent same-ID correction survives ACK of
   the older in-flight version. Keeping the B03 merge algorithm would lose that
   correction.
4. B07 ACK/removal and quarantine run under the durable queue lock and resolve
   only exact versions. Replay must use the same lock and serialization layer;
   a second queue implementation would reintroduce stale-snapshot overwrites.
5. B03 performs privacy admission both before and after Git enrichment and binds
   physical scope and final candidates into confirmation. Conflict resolution
   must retain the double filter and the shared 10-second deadline.
6. B07 queue/quarantine creation is owner-only and deliberately does not chmod
   historical files. Combination must not regress atomic temp/final permissions
   or silently rewrite unrelated state.
7. B06 partial ACK and old-server rowless poison isolation depend on B07 exact
   resolution. Legacy response compatibility, empty-probe fail-closed behavior
   and queue liveness must remain unchanged.
8. B07's upstream native CI was not yet green at dispatch time. The result is an
   experimental candidate until a fresh exact-SHA safe-branch run completes.

## Minimal resolution design

- Keep one queue implementation in `queue.ts`.
- Add a B03-compatible `mergeQueue` there, parameterized by queue path and lock
  options, but merge/dedupe by B07 exact normalized event version.
- Implement `mergeQueueEvents` and legacy `writeQueue` as default-path wrappers
  over that primitive.
- Preserve exact-version ACK/removal, quarantine-before-delete ordering and
  secure atomic writes.
- Re-export the combined queue API from `collect.ts`; retain B03's privacy
  admission order and replay call without weakening its deadline.
- Avoid changes to B06 server schema, B02 dependency work, B05 recovery logic,
  state files or release gates.

## Executable combination controls

The successor test must prove in one durable queue:

1. replay merge retains existing backlog and both same-ID corrected versions;
2. an exact ACK for the old version removes only that version;
3. a concurrent/new version and unrelated newly collected event survive;
4. a `beforeMutate` deadline failure under lock leaves bytes unchanged;
5. lock acquisition uses the supplied bounded timeout;
6. replay execution through its production default merge preserves an existing
   same-ID corrected version while admitting the confirmed historical version;
7. quarantine resolution remains exact-version and private.

Then run upstream B03/B07 focused suites, frozen negative/hash checks, Node 22
fresh install, verify, lint, full Vitest and production build. Native Windows,
Linux CI and real PG16 remain exact-SHA safe-branch gates rather than local
claims.
