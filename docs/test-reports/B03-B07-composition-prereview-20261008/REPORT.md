# B03 + B06 + B07 composition technical prereview

**Outcome: BLOCK (P1 replay CLI deadline breach).** This is an independent-worktree,
same-model-family technical prereview of exact product candidate
`116a1fffb2bd8c800f721adf1cd99653981da2df`. It is **not** the formal
different-model-family Evaluator verdict, a release signoff, or a human gate decision.
No product, state, prior report, or gate file was changed; nothing was pushed.

## P1: a real CLI replay exceeds its stated 10-second operation deadline

The reproducible native-Node-22/macOS negative uses a real Git repository as
the Claude row's cwd and puts this executable first on `PATH`:

```sh
#!/bin/sh
echo entered >> "$MARKER"
sleep 30
exit 1
```

The probe invokes the actual `src/cli/index.ts replay` command from a fresh
process, first as a dry-run, then with a digest from a real-Git preview and
`--execute --confirm`. On the exact candidate:

| Case | Wall time | Result | Shim calls | Durable queue |
| --- | ---: | --- | ---: | --- |
| Dry-run | 38,289 ms | Refused: `Git enrichment exceeded 10000ms deadline` | 2 | SHA unchanged |
| Execute | 38,275 ms | Same refusal | 2 additional | SHA unchanged |

The queue's SHA-256 remained
`66cef1a7a93e25d95ffca661464f0f7361d7dc818f273c0c9b62e1b5a1c03882`.
Thus the mutation boundary works in this negative, but the promised elapsed-time
bound does not. A user running either phase against a stalled `git` can wait
almost four times the budget; an indefinitely stalled startup Git process has
no timeout in this path.

Root cause is **before replay's clock starts**: `src/cli/index.ts:6` eagerly
imports `sync.ts`, which imports `agent-version.ts` at `sync.ts:5`.
`agent-version.ts:16-28` eagerly snapshots the startup SHA through an
`execFileSync("git", ...)` **without a timeout**. Its first shim call takes
30 seconds. Only after module loading does `replay.ts:88-89` construct the
10-second deadline; the second shim call goes through `git.ts:21-42` and
times out after roughly 8 seconds. The eager SHA snapshot is intentional for
daemon-version truth, so simply making that value lazy would weaken its
documented semantics. This prereview makes no fix; a successor should bound
the eager probe or avoid importing it for replay, then rerun the full CLI
negative with the same startup-SHA semantics and a hard outer guard.

Reproduction: run `evidence/git-deadline-cli-probe.ts` from this checkout with
Node 22 and `node --import tsx`; exact captured output is
`evidence/git-deadline-cli-observation.json`. The probe uses a temporary HOME,
queue and repository, no network service, and deletes its fixtures.

## Composition controls that passed

The separately designed `evidence/composition-negative.test.ts` ran **7/7 PASS**
with Node `v22.22.0` (`evidence/composition-negative.log`):

- In-flight old-version partial ACK plus confirmed historical replay plus a
  newly collected event retained both new active versions; the rejected row
  reached quarantine.
- Sequential rejected same-ID corrections remained as two exact versions in
  quarantine, rather than losing the later correction.
- A deadline guard fired while the queue lock existed, before any write; a
  lock-acquisition timeout also left legacy queue bytes unchanged.
- Dry-run left legacy-format queue, config, cursor and state SHA values
  unchanged and created no queue lock.
- A symlink parent source was refused; a lexically included but physically
  excluded symlink workspace failed privacy admission.
- Prior-server rowless `400 invalid_json` isolated a poison singleton only
  after an empty-envelope success; an empty-envelope failure kept the row
  active.
- Two simultaneous independent Node processes merged same-ID distinct
  versions and unrelated rows under the real file lock; new queue/directory
  permissions were owner-only on macOS.

This coverage supports the combined queue/ACK/privacy design but cannot
override the P1 end-to-end CLI deadline failure. The existing candidate tests
are not substituted for the adversarial controls above.

## Boundary and handoff

The isolated clone has no Git remote. The probe used this checkout's source
with the candidate worktree's installed `node_modules` through an ignored
symlink; it was **not** a fresh `npm ci`. No real PostgreSQL 16, native Windows,
full Node-22 suite, production build, deployment, or fleet behavior was
asserted here. Those and a different-model-family Evaluator remain separate
gates after the P1 is fixed. The accepted product policy is unchanged:
`local-only` backlog uploads on a later Agent/run/sync cycle after switching
to `sync`, while include/exclude edits affect future collection; historical
admission requires explicit bounded replay.
