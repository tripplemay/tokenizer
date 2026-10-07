# BL-PRIVACY-QUEUE-CLOSEOUT

## Ownership and baseline

User authorized implementation in the reported order and explicitly transferred
coordination to this conversation on 2026-10-08. All work stays in this isolated
worktree. Do not touch other worktrees, push any branch, deploy, or write a human
gate decision. Baseline is 82d6376e55903a20264808c7b859840354f704e0.
The original active BL-HOMEPAGE-FRESHNESS state is archived under
docs/archive/takeover-20261008/ and remains pending in the original repository.
This local batch does not close F005 or the full B03/B07 upgrade packages.

## F001 scope and integration adjudication

The baseline already contains B03 replay/deadline inputs through 6a030f6 and B06
partial ACK inputs through 694ff3c. Compose the B07 candidate 8bb0b88 plus
8cd118e and its frozen negative tests 7da2452 in this worktree, not by copying the
other combination worktree's uncommitted conflict resolutions.

Read these contracts and prior evidence as inputs, not proof of correctness:
- docs/specs/B03-scope-admission-slice-20261007.md
- docs/specs/B06-usage-partial-ack-quarantine-slice-20261008.md
- docs/test-reports/B03-B07-combination-generator-20261008/PLAN.md
- B03 prior evaluator artifact at 3220837 and B07 artifact at 9486633

Adjudication: queue.ts is the sole durable usage-queue implementation.
Expose a compatible mergeQueue(events, path, {timeoutMs, beforeMutate}) primitive.
B03 replay must acquire the SAME lock and use the SAME normalization/version
identity as B07 collection, ACK and quarantine. Do not retain two independent
queue writers. Preserve physical path admission both before and after Git
enrichment, source/plan/scope/final payload digest binding and the shared replay
deadline including external Git termination time. Do not change historical
event IDs or normal cursors. Rule edits never implicitly replay history.

B07 ACK removes exact normalized versions, never all rows sharing an event ID.
Quarantine stores each rejected exact version before deleting it from the active
queue. The prior same-ID quarantine version must not suppress a newly rejected
correction. Retry after interruption may duplicate but must not lose data.
Preserve owner-only atomic file creation and legacy B06 invalid_json handling.
Retain all existing admitted backlog regardless of later collection-rule edits.
Correct the B06 spec's old identity-only quarantine wording to this superseding
exact-version rule without rewriting old evaluator evidence.

Allowed source/config paths:
- src/cli/agent.ts, atomic-file.ts, collect.ts, index.ts, queue.ts,
  queue-event-version.ts, rejected-events.ts, sync.ts
- src/cli/replay.ts only for adapting to the shared primitive without widening
  replay scope or weakening its time/privacy guard
- .gitattributes, vitest.config.ts
- .github/workflows/deploy-vps.yml only for B07 PG16 probe selection
- tests/ci/b06-pg16-workflow-gate.test.ts and new B07/combination CI tests
- new tests/cli/b07-*, combination tests and native fixtures
- tests/server/b07-queue-id-ack-db.probe.test.ts
- this batch spec/state and new generator evidence directory

The old evaluator-owned tests and their SHA256SUMS MUST stay byte-identical:
tests/cli/agent-sync-checkpoint.test.ts,
tests/evaluator/bl-homepage-freshness-f002-f003.test.ts and every file under old
docs/test-reports directories. Archive/exclude obsolete tests only with a
successor covering their original invariants. Do not blindly apply upstream
commits that modified them. The B07 pinned byte attributes are not permission
to update expected hashes to whatever a checkout happens to contain.

No dependencies, database schema, server admission API, release signing, other
framework files or personal data changes. No real user source/queue/config reads.
Use disposable synthetic homes/fixtures. No raw diagnostic upload or deletion of
historical data in this slice.

## Required regression controls

1. Replay retains old backlog and multiple corrected versions of one event ID.
2. ACK of the old version removes only the old version; concurrent new versions
   and unrelated collection survive.
3. A guard failure immediately before mutation under lock leaves queue bytes
   unchanged. Supplied lock timeout is honored.
4. Production replay path uses that shared primitive and preserves an existing
   corrected version when admitting a confirmed older historical version.
5. Same-ID distinct rejected versions are both durable in quarantine; all exact
   accepted/rejected resolutions are idempotent.
6. Prior symlink, FIFO, dot-segment, physical-scope, changed-confirmation and Git
   timeout/final admission controls stay effective.
7. Existing evaluator tests retain original bytes; portable Windows byte policy
   is checked without altering expected hashes.
8. Real two-process HTTP interleaving, quarantine write failure and crash/retry
   controls preserve events and do not leak permissions.

Run fresh Node 22 npm ci in this worktree; no shared node_modules.
Record lint, verify, focused controls, full tests and production build outputs.
Separate environment-gated skips, native Windows/Linux and PG16 from local
macOS checks. Do not execute native service installers against the user's
running Agent.

## F002 independent acceptance

Use a fresh evaluator from a different model family than Codex. Evaluator may
write tests and reports, never product code or edit old verdicts. Reconstruct
expectations from this spec and real behavior; generator reports are claims.
Deliver schema-valid per-feature verdict, exact SHA, commands, observed
counterexamples and boundary limitations. Missing exact-SHA platform CI does not
become PASS by inference. Production/F005/human release gates remain outside
this slice. Any FAIL returns F001 to fixing; Coordinator must preserve the
evaluator's original wording and artifacts.

## Deferred work

After this safety composition is accepted: finish the remaining B03 privacy
controls, OpenCode mutable-source/cursor consistency, B08 CAS, B04/B05 release
gates, B09-B14 journeys and then later features. User approval sets ordering,
not a blanket authorization for destructive cleanup, production deployment,
third-party account access or bypassing independent review.
