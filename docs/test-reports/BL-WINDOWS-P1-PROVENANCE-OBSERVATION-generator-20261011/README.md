# Windows P1 provenance observation: SOURCE_FROZEN / DEVELOPMENT_ONLY

Fresh supporting Generator under harness-rules section 1.5, not Coordinator,
Planner, Evaluator or release authority. Start was clean at
`10470c1b6064c83bd0a6712106e3009fe355e7f3`; runtime comparison baseline is
`712cf210b089dc71f3a6e6ed2e19e1de7fee57da`.

## Frozen source

- Source commit: `62d419b2a419b685542efaaf047b8a749839d493`.
- Only source path: `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`.
- SHA-256: `411c9e10fe35bfe231d0c5daf0b01ead77f18464688d67a910c103e433d760b1`.
- Bytes: **77,285**; Git mode `100644`; actual permissions `644`.
- One source-only local commit, no amend/push; source frozen before report work.

The separately authorized `PREPARE_P11_REASON_V1_84` is a new **84-byte**
terminal contract, not old80 compliance. Exact existing prepare, terminal
caught P11 failure only: unchanged generic **51** + original P11 **29** +
one fixed allowlisted `V00\n`-`V17\n` **4**. Other prepare phases retain
old80 or less. No new success/other-mode/import/guard/probe output, stdout,
persisted files/fields/uploads. Original failure exit1 is unchanged.

## Manual finite-slot review and passive byte checks

The locked proposal was read from own disk: SHA-256
`f6b28719bc9cfc77aa8b80bba98d9de4791265d3a3cd0246eff3e7ab338c5f92`.
Fresh pre-scope SCOPE-02/03/04 and the sole externally authorized read-only
Coordinator adjudication were read, not replaced by dialogue.

- **S1:** non-exported inactive module-local state, exactly18 fixed four-byte
  output literals. No target-data strings or new property/error reads.
- **S2:** original schema call once; same conditional stringify/parse once,
  same order/arguments; existing unbound catch returns null. Schema false
  V02, caught schema V03 and clone V04 survive the existing `!v` guard.
- **S3:** original compound predicate text, short-circuit/property reads,
  calls/order/arguments remain grouped. In-flight/false/true observation is
  group-only; final original expression is bound once and returned unchanged.
  Original P11 `assert(validateProvenance(...))` remains unchanged.
- **S4:** only the already-matched exact prepare arm activates unknown.
- **S5:** successful write remains unchanged, followed by deactivation.
- **S6:** only active P11 appends one literal after existing outputs; an
  invalid/unassigned/nonmember reason falls back only to V00.

Every observer assignment in S2/S3 is explicitly guarded by active exact
prepare **and** current `prepareFailurePhase === 'P11'`. The local stage is
declared unassigned; its schema/clone writes also have that full guard.
P12 `writeJson` calls provenance rebuild before S5, but cannot write the
observer. V17 is only an unknown P11 assertion anomaly, not a cause/error
classification or a P12/helper reason.

`static-audit.json` and raw audit output establish six-slot byte reversal
back to source712 exactly, 15-path closure with only the CLI delta, all10
binding frozen inputs matching and all57 old archive files unchanged.
The original and final source bytes and full diff are retained in
`source-originals/`. No target VM, added diagnostic, probe, helper call,
native/PID/kill or target fixture was used by this audit. This is Generator
development evidence, not independent scope or functional acceptance.

Binding/md hashes/schema definitions, guards/env allowlists, checkout keys,
SystemRoot/runners/Node/native API/E0/B001/worker/EOF/cleanup/atomic append,
caps/budgets/selection/T0-T3/11 source paths/16 uploads/both source passes,
P00-P12 and old81 test bytes were not changed.

## Owned one-time development execution

`run-command.mjs` uses Node22.22.0 and a fixed minimal PATH; HOME and
USERPROFILE are `/Volumes/ORICO/project/.wp1provog-20261011`; all temp and
npmcache are dedicated children. No borrowed dependency/cache/node_modules,
real-home/system-temp/manual symlink/global install/audit fix was used.
Each command retains separate stdout/stderr, interleaved raw bytes, exact
arguments/environment/status/signal and timestamps in `*.result.json` and
`command-ledger.json`. Raw output is not trimmed.

- Fresh own `npm ci`: **once**, exit0; 670 packages, audit672; **7 high**
  vulnerabilities retained, not fixed.
- Unmodified `tests/diagnostics/windows-p1-stages.test.ts`: **81 passed**,
  exit0, full original JSON/stdout/stderr retained. Its already-frozen
  synthetic VM slices were permitted; no new target VM was introduced.
- `npm run verify`: exit0 (Prisma5.22.0 + TypeScript noEmit).
- Final `node --check`: exit0; ordinary pure import without any exported
  helper call/query guard: exit0 with stdout0/stderr0.

### SWC fallback is explicitly present

Despite top-level install stdout being silent about fallback, original own
npm debug logs prove `@swc/core@1.16.13` package-owned postinstall ran an
internal public-registry `npm install --no-save ... @swc/wasm@1.16.13` in
its own temporary `node_modules/@swc/core/npm-install` directory. This is
the separately allowed package lifecycle fallback, not a manually added
install. Installed wasm is **1.16.13**, absent from the unchanged root lock
and installed root lock. The package postinstall moves it to root own
`node_modules/@swc/wasm` and deletes its temporary directory; missing
temporary package/lock files are recorded as absent, not reconstructed.

All3 own npmcache `_logs` originals, root package/lock, installed lock,
SWC core index/binding/package/postinstall and wasm package.json, Prisma
package/postinstall and better-sqlite package originals are archived with
hashes in `install-evidence.json`. Full wasm file inventory is byte/hashed;
only its requested package metadata is copied, not its wasm binary.
All47 npm-created symlinks resolve inside this own worktree; vendor tracked
bytes and root lock bytes match source712. No native P1 acceptance follows
from allowed package lifecycle operations.

## Failures retained, never relabeled

Two initial passive lowercase `rg` searches returned exit1 with empty
output; exact original tool command/status/output are in
`manual-read-failure-ledger.json`, explicitly not claimed as shell raw logs.
First static audit failed on an incorrect ledger-array access (TypeError),
then one passive report-script correction succeeded. First install evidence
capture guessed the temporary wasm location and failed ENOENT after partial
original copies; its unaltered script/output/status are retained, then one
passive path correction/equal-original check succeeded. These were report
errors, not target diagnostics, retries of install or source712 reruns.
Final integrity command20 first failed MODULE_NOT_FOUND because the manual
absolute patch mistakenly placed its report script at this own worktree
root. It was immediately moved by absolute apply_patch into the allowed
report namespace, never staged/committed at root. This transient report
scope mistake and its full output/status are explicitly retained; no source
or state file changed. The corrected passive integrity check followed.
Original log trailing blank lines are deliberately retained; any staged
raw-log diff-check failure is archived rather than fixed by trimming.

## Handoff boundary

**SOURCE_FROZEN / DEVELOPMENT_ONLY**, not PASS/signoff/release.
Fresh exact-source passive post-scope and separately commissioned fresh
different-family Kimi gate remain necessary. No negative runtime controls
for the new reason observation were executed here; old81 does not test or
accept the new84 contract. No CI/publication/native/production/maintenance,
state/features/pending_gate/memory/registry/harness write or parent file
creation occurred. Compose stays HARD_STOP/no third attempt. Keys remain
deferred; no backup/restore/baseline/password work. `release_ready=false`.

`manifest.json` covers all report payload files except itself and its
`SHA256SUMS` derivative; neither file asserts its own hash or a future report
commit hash. The final local report-only commit and whole-directory count
are delivered separately to the Coordinator.
