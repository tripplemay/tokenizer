# B03 Generator round3: physical admission and confirmation

This is a Generator handoff, not cross-family evaluation, a release verdict,
or full B03 closeout. No push, production access, state/gate edits or Vitest
exclusion changes.

## Commit chain and immutable context

Base `420b539f8a233c11bf4b8c608d77db71df9dc488`:

1. R1/R2/R3 source boundaries: `c69ef68edc3c973e3e9a2fc4a11d69009ebd01f1`.
2. Round1 evidence: `d86c5810cd0f6b15216425f9a25c324971b1f362`, kept unchanged.
3. Default macOS test fixture repair: `86aabe9a2297e8621b30d6a5b12a2b15e2777bfa`.
4. R4/R5/confirmation product repair:
   `83a6eba9a977cc8717381a28e5e3bf2f44a923bc`.

Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b03-replay-fixed-candidate-20261008`.
The original a8a4072 pre-review is untouched. Round1 hashes continue to describe
their commit snapshot, NOT current source; round2 verifies all 24 old entries
against that exact archived snapshot. New evidence directories are additive.
There are no new active tests reading historical Git objects.

Coordinator's later technical pre-review probe was read-only input at
`tokenizer-b03-fixed-prereview-20261008/tests/cli/b03-fixed-prereview-independent.test.ts`:
7 passed / 2 failed, including these two additional BLOCKs. That same-family
technical review is not formal independent acceptance. Its tree was not edited.

## R4/R5 reproduced and fixed on both admission paths

- **R4 dot alias**: cwd `allowed/../denied` bypassed lexical include/exclude;
  direct denied was rejected but alias preview wouldAdmit was 1.
- **R5 physical alias/enrichment**: an allowed symlink to an excluded Git repo
  passed initial filtering, then Git supplied denied localWorkspacePath and the
  row entered durable queue. The old include `some` also let an allowed path
  rescue a different outside-include path.

New `privacy-scope-safety.test.ts` reproduces these and covers ordinary
`collectEvents`, bounded replay preview/execution, retained legacy backlog,
outside-include alias, nonexistent descendants beneath a link, broken link,
multi-path include/exclude precedence, Windows separator/traversal spelling,
unchanged wire identity, and a controlled enrichment output introducing an
excluded localWorkspacePath. It uses physical temporary fixture roots.

Before repair: `scope-before.log`, 6 failed / 1 passed. Five failures expose
unsafe admission; the sixth is the formerly rejected positive alias whose
physical target is inside include. After the first product repair, three tests
failed only because the authored legacy queue fixture omitted the existing
sanitizer's repoKey/gitRemote null fields. `scope-after-development.log` retains
those raw failures; the fixture was corrected to the established format,
without weakening the zero-admission/backlog assertions.

Production changes are limited to privacy.ts, collect.ts and replay.ts:

- Admission resolves native existing physical paths with realpath. For missing
  descendants it resolves the nearest existing ancestor before appending the
  missing tail, so an existing symlink ancestor cannot evade scope.
- Broken links and resolution errors fail closed. Dot components in event or
  rule paths fail closed; callers should use absolute canonical rule paths.
  Foreign-platform legacy paths use their native lexical path implementation
  because this host cannot resolve the foreign filesystem. Windows physical
  behavior still requires real native evidence.
- Every available workspace/localWorkspace path must lie within a physical
  include root when includes are set; ANY exclude match takes precedence.
- New collection/replay rows are checked both before Git enrichment (avoid
  probing known excluded locations) and after it (new localWorkspace cannot
  escape admission). Dry-run uses that same final candidate boundary.
- With no configured include/exclude restrictions, legacy no-workspace events
  remain compatible. No global shared/path normalization, event-ID, wire-path,
  cursor or historical queue identity change was made.

## R6: filesystem-driven confirmation drift

The new physical admission exposed another real confirmation bug: with source
bytes and configuration unchanged, retargeting cwd alias denied -> allowed
changed preview 0 -> 1 but left the old digest equal. This is independently
reproduced by this Generator in `alias-confirmation-before.log` (1 intentionally
failed targeted test; other tests are selection skips, not acceptance evidence).

Confirmation now binds **full minimized candidate payloads**, plus each selected
row's resolved physical workspace/localWorkspace and physical rule roots. It is
not a count-only or ID-only hash. Before merge, execution filters/enriches the
full selected set again under current privacy, recomputes this binding and
requires the same digest. File/config/projectRoots identity checks still run.
No fingerprint is added to transmitted events or cursor/queue identities.

Successor negatives prove refusal before merge for:

- zero -> one admitted row after alias retarget;
- same count and same wire payload, but a different physical target;
- same count but different selected eligible rows;
- alias retarget inside readCurrentConfig, before durable merge;
- same count/ID/physical scope but different candidate GitBranch payload,
  including a change just before merge.

Scope checks are checkpointed filesystem observations, not atomic kernel path
capabilities. This does not claim to defeat every hostile OS interleaving or
bound arbitrary kernel/network filesystem stalls. Git's existing cache and
subprocess behavior is not redesigned. The elapsed parse check now also covers
completed enrichment/binding work, but is not a kill timeout for every Git call.
Original R1 ancestor checks, POSIX FIFO nonblocking safe refusal, file/range/byte/
record/event limits and physical source-only refusal remain intact.

## User-selected privacy semantics retained

Rule edits affect only subsequent collection. Previously excluded history is
NOT auto-filled. Historical replay is explicit, one-file bounded, dry-run by
default, confirmed by digest. Already admitted backlog is NOT refiltered using
new rules. Switching local-only -> sync uploads retained backlog automatically
at the next Agent/run/sync cycle, not within configure. The real CLI lifecycle
regression proves old excluded prefixes remain absent, later appends are newly
admitted, old backlog/cursors survive, and next sync uploads the expected set.
Queue merge/ACK concurrency regressions remain passing. This slice does not
clean production history or change other Agents' queue/ACK semantics.

## Final local validation

Node22.22.0 on darwin arm64, **default inherited macOS TMPDIR**, no custom TMPDIR
needed. All final commands were sequential with no Generator-owned concurrent
stress/build. Raw intermediate failures and earlier passing runs are retained.

- Final focused: **110 passed / 1 Windows-only skipped**, 11 files,
  `focused-final-4.log`. All 13 new scope regressions run and pass.
- Final standard `npm test`: **1635 passed / 24 skipped**, 126 passed files,
  9 skipped files, `full-final-3.log`, exit0. Earlier pre-confirmation runs had
  1630/1631 passed and are not mislabeled as final-source validation.
- Final verify/lint/build: all exit0; `verify-final-2.log`, `lint-final.log`,
  `build-final.log`.
- Older independent manifest 4 OK and older admission Generator manifest 18 OK;
  neither changed. Round1 report/manifest remain bound to their original commit.
- Default temporary-fixture-only phase: 1622/24 full and 92/1 focused, recorded
  separately in round2. Round1 ORICO-TMPDIR checks are not relabeled as default
  macOS evidence.

Reproduce with Node22, no task TMPDIR override:

```sh
node node_modules/vitest/vitest.mjs run tests/cli/privacy-scope-safety.test.ts tests/cli/privacy.test.ts tests/cli/replay-contract.test.ts tests/cli/replay-operational-contract.test.ts tests/cli/agent-sync-checkpoint.test.ts tests/cli/sync-retry.test.ts tests/cli/replay.test.ts tests/cli/queue-merge.test.ts tests/cli/replay-safety-regression.test.ts tests/cli/privacy-admission-cli.test.ts tests/cli/replay-help.test.ts
npm test
npm run verify
npm run lint
npm run build
shasum -a 256 -c docs/test-reports/B03-replay-scope-safety-20261008/evidence/SHA256SUMS
```

Native Windows/NTFS junction/opaque reparse/PowerShell behavior, PG/browser CI and
cross-family evaluation remain Coordinator-owned **NOT RUN** gates here. The
POSIX FIFO test runs on this host; the Windows-only unsupported-source test is
not claimed to have passed. No release/full-B03 completion claim.
