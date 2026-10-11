# BL-WINDOWS-P1-PREPARE-OBSERVATION — evidence/scope supplementary evaluation (kimi-r1)

Role: fresh independent registered Kimi-family PASSIVE evidence/scope supplementary Evaluator
(harness-rules.md 第1.5步 independent task), batch `BL-WINDOWS-P1-PREPARE-OBSERVATION-EVIDENCE-SUPPORT`,
feature F004, task `windows-p1-prepare-observation-712cf21-evidence-kimi-r1`. Sole supplementary
opportunity for source712 — not new functional acceptance, not a C002/Compose retry. All conclusions
are OFFLINE passive-supporting only: no native/Windows finding, no formal F004/F005 acceptance, no
release readiness, no CI/publication authority granted (Coordinator alone may later decide one
new-source non-main CI; this evaluator grants none). Original Windows prepare root cause remains
**unknown**.

Method: passive code/log inspection + own read-only reversible analyst transform. No import/compile/
eval/VM-run of candidate, author scripts, static-proof, proposal or any test; no install/network/
native/diagnostic execution. Manual files authored only via absolute apply_patch; machine-generated
captures under `raw/`.

## Independently recomputed facts (all raw outputs under `raw/`)

1. **r0 transport integrity 39/39** (`raw/r0-transport-39-verify.txt`): every destination
   byte-length and sha256 matches `windows-prepare-observation-kimi-r0-transport-manifest.json`;
   sum 1026146 bytes matches declared. Immutable r0 verdict independently rehashed:
   `e44448af82c920711e24283924ce7ca837b75ffb2dae1659532260b5e264c8de` — matches manifest,
   adjudication and contract pin.
2. **Generator/post-scope originals 49/49** (`raw/generator-postscope-49-verify.txt`): destinations
   match manifest AND committed blobs at `afcb169` (generator) / `6bae786` (post-scope);
   sum 1225388 matches declared.
3. **Planner/pre-scope originals 9/9** (`raw/planner-prescope-originals-verify.txt`): 7 plan files
   match planner manifest + blobs at `22946b3`; 2 pre-scope files match adjudication-pinned hashes
   `952f0b04…`/`f96f8ca7…` + blobs at `27dd6bc`.
4. **MAIN OBLIGATION — exact remaining bytes** (`analyst-transform.mjs`,
   `raw/analyst-transform-result.json`): candidate CLI
   `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` at source712 = 74301 B,
   sha256 `c245a528fb8549915396b5f052bf3841f35b03d88d6b7b5e91982b6f0f07dc4f` (pin match).
   Own transform removed ONLY the 20 commissioned slots — 16-line module state block (incl. 13
   fixed 29-byte literals), 12 phase assignments P01–P12, success reset, 4 statement rejoins
   reversing the original statement/local split (incl. `prepareSourceFiles` re-inlined into the
   unchanged `validateProvenance` assertion), P00 dispatch activation, 2-line terminal-catch
   lookup; each slot asserted to occur exactly once. Result: 73022 B, sha256
   `6548ea1cbf7584873f61b4cb396bc9d4ce8567c672d23313b56a38e8ce0d3bae`, **Buffer-exact equal to
   baseline61 blob** (`output_equals_baseline61_buffer: true`), zero residual observation tokens,
   **no whitespace normalization**. This supersedes r0's weaker whitespace-stripped recovery claim.
5. **Changed path/mode tree records** (`raw/git-tree-records.txt`): commit `712cf21` touches exactly
   one path, mode 100644→100644 (blob `311d04a`→`8e1b80f`); full `61cf64e..712cf21` delta = that 1
   modification + 9 declared Planner/pre-scope report additions, nothing else; worktree clean.
   Original control test `tests/diagnostics/windows-p1-stages.test.ts` blob identical in both
   commits (`7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`).
6. **SWC fallback audit** (`raw/swc-fallback-audit.txt`): npm-debug `2026-10-11T18_19_59_609Z`
   shows argv `install --no-save --loglevel error --prefer-offline --no-audit --progress false
   @swc/wasm@1.16.13`, registry packument + tarball GET 200, cwd inside
   `node_modules/@swc/core/npm-install`, exit 0 — i.e. **package-owned** fallback:
   `@swc/core@1.16.13` `postinstall.js` line 125 contains exactly that `child_process.execSync`
   command (passive read). Installed `@swc/wasm` is 1.16.13; `@swc/wasm` is **absent** from both
   the installed lock original and the committed source712 `package-lock.json`. 7 high severity
   vulnerabilities remain per r0 `npm-ci.stdout.txt`. Therefore: neither a no-fallback claim nor an
   all-lock-only claim is sustainable; nothing here is native/dependency-security acceptance.
7. **r0 receipts** (`raw/r0-controls-and-receipts-audit.txt`): run-meta/receipt exit 0,
   duration 1294 s (< 1500/1800), `process_exit`, outcome RETURNED/COMPLETED, coordinator mechanical
   validation passed; own40 40/40 exit 0 (single run), original81 81/81 exit 0, verify/verify2 exit
   0, npm ci exit 0 (670 packages).

## Static vs runtime coverage distinction

- **Runtime (behavioral) controls** exist only as: r0's additive VM-sliced suite (40/40, synthetic
  `node:vm` slices of real source strings, stubbed fs/child/OS — not the real process); the
  unchanged original81 (exercises baseline behavior, not the new emission); generator
  syntax/pure-import/verify exit 0 (silence, not emission).
- **Static controls**: byte shapes/lengths, slot placement, literal 29-byte shapes, exact-byte
  recovery (this round), tree/mode records, hash pins.
- **Never proven anywhere**: real-process emission of `TW_P1_PREPARE_FAILURE_V1:*` by an actual
  failing Windows prepare; P00 dispatch/terminal-catch behavior in a real process; real
  Windows/native feasibility; the original prepare failure cause (unknown). Negative/privacy/
  silence controls are VM-synthetic (static-derived), not real-runtime.
- **Sufficiency**: as narrow offline evidence/scope support for a possible single future
  Coordinator-authorized new-source non-main CI observation, the artifact set is sufficient and
  internally consistent. It is not sufficient for functional acceptance, native acceptance, or
  release decisions.

## r0 deviations confirmed from originals (retained, not softened, not retro-authorized)

- Two analyst scripts (`author-script1/2-original.mjs`) were manually cat-authored in own HOME
  contrary to the apply_patch-only instruction; an apply_patch probe (`author-probe-original.txt`,
  9 bytes `probe-ok\n`) ran in own HOME outside the authored whitelist. Hashes verified; retained
  as evidence; **not** retrospectively authorized.
- Initial static check (`raw/static-verify.json`) contained false intermediate results
  (`map_has_exactly_13: false`, `recovered_equals_baseline_ws_stripped: false`,
  `leftover_prepareFailure_refs: 1`); corrected result (`static-verify2.json`) proves only
  whitespace-stripped recovery and shows `block_removed: false` — internally inconsistent as
  exact-byte proof. Own-test pre-run corrections are recorded in the preserved runtime log.
- README timeline note is retrospective narrative, not a separately persisted provisional PARTIAL;
  receipt 1294 s is authoritative, relative timestamps approximate.

## Boundary

Original r0 PASS (sha256 e44448af…) stands unrewritten as OFFLINE supporting only. This r1 round
adds the missing different-family exact-byte restoration proof and independent artifact verification.
release_ready=false; main/production/state/features/pending_gate/memory/registry/harness unchanged;
keys deferred; E0/B001/worker/EOF/cleanup/atomic/caps/budgets/11 sources/16 uploads/81 old tests/
five checkout keys remain frozen; no third dispatch, family fallback, deadline extension or Compose
attempt is implied or granted.
