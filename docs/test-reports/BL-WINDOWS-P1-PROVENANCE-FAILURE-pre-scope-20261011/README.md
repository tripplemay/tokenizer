# Windows P1 provenance failure: PASS_SCOPE_ONLY

Fresh supporting passive pre-scope/spec critic, harness-rules section 1.5.
This is not Planner, Generator, Coordinator or functional Evaluator work.
The worktree started clean at `719660c10805b5ab0d4e56e6b8317283c95c37b2`.
Runtime source remains `712cf210b089dc71f3a6e6ed2e19e1de7fee57da`.

## Decision

**PASS_SCOPE_ONLY**, with no blocking finding in the conditional S1-S6 design.
The plan is finite and can be implemented without changing the checks if all
its joint constraints are obeyed. This does **not** accept the proposed
`PREPARE_P11_REASON_V1_84`, authorize implementation, CI/publication/native
execution, source712 retry, further Kimi, F004/F005 or release.

The old maximum is already full: generic **51** bytes plus original P11
**29** bytes, both including LF, equals **80**. Adding one unchanged
`V00\n`-`V17\n` literal adds **4** bytes and gives **84**, not 80.
No reason line, shortened/reused/reinterpreted marker or new observation is
permitted under the old authority. The independently proposed 84-byte
contract still requires a separate Coordinator ruling and commission.

## Decisive scope checks

- **S1-S2:** non-exported, initially inactive, exact prepare/P11-only state.
  The original schema call remains once. JSON stringify and parse remain
  conditional on schema true and once each, in the same order.
  The existing unbound catch still returns null. V02 schema-false,
  V03 caught-schema and V04 caught-clone remain latched through the original
  `!v` guard; they cannot become V06.
- **S3:** retain each original compound expression, short-circuit, read,
  call, argument and order. Assign only fixed operation-group enums before
  the original operation and false enums before the existing false return.
  Bind the final expression once if needed, latch its Boolean result and
  return that exact result. Aggregate reasons do not identify a unique field.
  Escaping throws retain the preceding in-flight enum; no error binding,
  getter/error-property inspection, new validation or new data read.
- **S4-S6:** activate only inside the already-matched prepare arm; leave
  the P11 assertion unchanged; deactivate after the unchanged successful
  write. Reason emission is only terminal exact prepare/P11 and only one
  fixed LF-only allowlisted four-byte literal, after unchanged generic and
  original phase output, with unchanged exit 1.

### P12/V17 isolation is a joint hard constraint

At source712 lines 738-740, P12 is assigned and `writeJson(..., 'provenance',
provenance)` runs **before** success deactivation. That helper calls the same
`rebuild('provenance', ...)` at lines 672-677. An activation flag alone is
therefore insufficient. S1's P11-only requirement and S2's active exact prepare
P11 restriction must phase-qualify **every** observer write, including S3.
Otherwise the P12 helper would overwrite the P11 classification.

V17 only means the validator returned true but P11 did not complete: an
assertion/observation anomaly, still unknown. Once P12 is reached it cannot
enable P11 observer writes, a P12 reason or success output. Missing
deactivation, non-P11 writes and post-V17 helper leakage are explicit
future negative controls, not implementation choices newly granted here.

## Original evidence and frozen boundaries

The proposal was read from disk, not accepted from dialogue:
`proposal.json` is 9,716 bytes, SHA-256
`f6b28719bc9cfc77aa8b80bba98d9de4791265d3a3cd0246eff3e7ab338c5f92`.

The fresh raw ledger independently recomputes:
- Planner transport **20 / 20** entries, **97,696** bytes; external/local/
  committed blobs equal, all committed modes `100644`. Manifest SHA-256
  `ff3b4d2c5922201fe34ccc0aadcd0e768f7c1f435bd2049045955f519935ab23`.
- Runtime transport **7 / 7** entries, **37,590** bytes; all hashes/lengths
  match. Manifest SHA-256
  `038bf22a6be697c6cf5eb62885c29919e7d181e0627e8c8fcd96cbfe0def93ea`.
- All **15** inspected source-closure paths equal source712 blobs, including
  the exact CLI, test, workflow and binding MD/JSON. All **10** prior/frozen
  input hashes match the current binding.
- All **57** tracked files in
  `docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/`
  equal source712; tree-row SHA-256
  `cb15965730dad49aa8d1f138ef0014eff975b96447c93f2e866e9e39721548b3`.
  This is not re-authentication of the larger historical run inventory.
- The test remains byte-frozen at
  `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`;
  no old81 execution or renewed passing acceptance is claimed.
- Both prepare `sourceFiles()` passes remain distinct; **11** source paths,
  **16** upload paths and the **five** checkout-only environment map keys
  remain unchanged.

Owned file/directory identity, native E0/B001 actual API/owned-native tuple,
worker, EOF, cleanup, strict atomic append, caps, budgets, selection and
T0-T3 are frozen. The new parent terminal reason is not an increase in any
native/parser/guard/output/file budget. Binding hashes and schema/environment
allowlists are not editable slots.

Original captured final/jobs/log/artifacts bind run **38165950837**, attempt
**1**, job **114548428887**, source712 and failure. Full log lines 145-148
contain generic output, exactly one P11 payload and exit 1. Seal lines
149-154 belong to a separate invocation. Install, synthetic checks and
INITIAL were skipped; verification/upload skipped; artifacts **0**.

P11 is `assert(validateProvenance(...))`, not a validator-false-only fact.
Both false/assertion and escaping validator exceptions remain possible.
Displayed runner image is not `process.env.ImageOS/ImageVersion`; no unique
runtime-field mismatch or schema repair is proved. Timestamped GitHub logs
are not a raw Windows stderr delivery guarantee. No native/worker/EOF/cleanup/
E0 observation or release success follows.

## Required future gates

`verdict.json` lists mandatory negative controls: false versus caught
schema/clone versus uncaught validator versus unknown; V17/P12 lifetime;
throwing getter/error/canary zero additional reads; unchanged call counts,
arguments and short-circuit; both source passes; 84 versus old80; LF/CRLF,
duplicate/dynamic/nonmember/truncated output; wrong modes/success/missing
reset; and all frozen schema/env/guard/native/runtime/state boundaries.

No such control was executed here. Original operations can themselves
encounter a getter or throw; the observer must not add or duplicate those
reads, suppress them, or inspect the thrown value.

A separate Coordinator ruling and exact Generator commission, then fresh
exact-diff post-scope and a separately commissioned different-family
supporting gate, remain required before any later observation. Source712's
sole Kimi supplement is spent; neither it nor source712 is to be rerun.

## Execution and error ledger

Only shell focused reads and newly written inline Node builtin byte/hash/
JSON-as-data/static-git inspection were used. No candidate/proposal/existing
analyst script/import/compile/VM/fixture/test/probe/native/OS PID/network/GH/
SSH/Docker/DB/install work was performed. No state/feature/pending_gate/
memory/registry/harness/source file was written; no push or amend.

Two read-only guessed paths failed. The failed inline Node command/output/
status is retained completely in `raw-ledger.json`. The first rg result was
fully present in the tool transcript; its report copy is explicitly labeled
a complete unchanged-source same-command reconstruction, not a saved raw
first invocation. The corrected checker then passed. No diagnostic result
was produced or hidden by these errors.

Compose remains **HARD_STOP**, no third attempt; keys remain deferred;
no backup/restore/baseline/password work; `release_ready=false`.

Only this report directory is submitted locally. No self-hash or future
commit hash is claimed by its files.
