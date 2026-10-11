# Windows P1 provenance observation: PASS_SCOPE_ONLY

Fresh supporting passive actual-diff/post-scope critic under harness-rules
section 1.5. Not Planner, Generator, Coordinator or functional Evaluator.
No blocking finding was identified in the exact commissioned source.

## Exact subject and authority

- Source: `62d419b2a419b685542efaaf047b8a749839d493`.
- Source parent: `10470c1b6064c83bd0a6712106e3009fe355e7f3`.
- Frozen baseline: `712cf210b089dc71f3a6e6ed2e19e1de7fee57da`.
- Sole modified existing path:
  `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`.
- Current raw file equals the source blob, mode `100644`, permission `644`,
  **77,285 bytes**, SHA-256
  `411c9e10fe35bfe231d0c5daf0b01ead77f18464688d67a910c103e433d760b1`.
- Locked proposal: **9,716 bytes**, SHA-256
  `f6b28719bc9cfc77aa8b80bba98d9de4791265d3a3cd0246eff3e7ab338c5f92`.

The separately read Coordinator ruling explicitly commissions the new
`PREPARE_P11_REASON_V1_84` candidate, subject to S1-S6 and the joint critic
conditions. This is **not old80 compliance**. This critic's PASS_SCOPE_ONLY
does not create authority or grant functional acceptance, different-family
acceptance, CI, publication, native execution, F004/F005 or release.

## Actual S1-S6 review

- **S1, lines 43-49:** initially inactive, module-local, non-exported state;
  exactly eighteen literal `V00\n` through `V17\n` lines. Each is exactly
  four ASCII bytes with LF, not CRLF. No data-derived reason string.
- **S2, lines 97-112:** one unchanged `schemaMatches(defs[name], value)`;
  stringify once and parse once, in the original order, only when its result
  is truthy. The unbound catch still returns null. Only local branch splitting
  and fixed observer stage/reason assignments were added. Every S2 observer
  write is active + current P11 + `name === 'provenance'` qualified.
- **S3, lines 716-745:** all original operation-group expressions remain
  verbatim, including compound short-circuit, property reads, original calls,
  arguments, order, false returns and final return value. The final expression
  is evaluated once into `valid`, latched, then that same value is returned.
  Before-group intervals and false branches are distinct, not unique causes.
- **S4, line 1145:** only the already-matched exact `same(args, ['--prepare'])`
  arm activates and initializes the observer; no extra argv/environment read.
- **S5, line 784:** successful prepare deactivates after the unchanged P12
  write and the original phase reset. No output or persisted observer state.
- **S6, lines 1159-1160:** one allowlisted literal lookup with V00 fallback,
  only active exact prepare terminal P11 failure, after the original generic
  and original phase line, before the unchanged exit-code assignment.

The source adds no error binding, caught-value/property/getter inspection,
raw environment/path/hash/content serialization, observer export, extra
validation or helper call. Original operations can themselves encounter
getters or errors; their property reads and calls were not added, removed,
duplicated or replaced. No throwing-getter/canary behavior was executed here.

### V02/V03/V04 and P12/V17

The first `!v` group still has its original expression. V05 and V06 observer
assignments additionally require truthy `v`, so schema false V02 and caught
schema/clone V03/V04 survive its false return. Truth-testing a local result
adds no property/getter access. Every S3 reason assignment is active + P11
qualified. There are **15** reason writes across S2/S3: two S2 and thirteen S3.

The unchanged P11 `assert(validateProvenance(provenance, prepareSourceFiles,
executionSha))` is neither split nor cached. When P12 is reached, its unchanged
`writeJson` calls rebuild, but P11-qualified S2/S3 assignments cannot run.
V17 means true-then-P11-anomaly, still unknown; it cannot mutate a later helper,
emit a P12 reason, or create successful output. No new thrown-value diagnosis.

Only exact terminal P11 can add four bytes: **51 + 29 + 4 = 84**. Other prepare
phases remain at most 80. Success, other modes, wrong/extra argv, import,
guard and probe add no output; there are no new stdout bytes, stored fields,
files or uploads. Invalid/nonmember or unassigned reason strings select only
V00; module-local assignments are exclusively fixed codebook literals.

## Raw-byte reversal and complete tracked closure

The independent inline checker removes only the exact S1-S6 observer bytes
and reverses only their permitted local statement/branch splitting, with each
literal replacement required to occur exactly once. **18** recorded inverse
operations restore the whole baseline CLI **BYTE EXACT**, without whitespace,
line-ending or other normalization: **74,301 bytes**, SHA-256
`c245a528fb8549915396b5f052bf3841f35b03d88d6b7b5e91982b6f0f07dc4f`.
The exact command and per-operation hashes are retained in `raw-ledger.json`.

Baseline has **2,472** tracked files; source has **2,495**. The checker read
all **2,495** source worktree files, **24,142,355** raw bytes, recomputing each
Git blob identity and checking regular/non-symlink identity and permissions:
**2,394** files `644`, **101** files `755`, matching all Git modes. The entire
source/baseline tree delta is only the CLI modification plus the declared
Planner **20** and pre-scope **3** report additions, all added files `100644`.
All remaining baseline modes/blobs and all source raw bytes are identical.

This freezes bindings MD/JSON and hash literals, schema implementation and
schemas, environment allowlists, workflow and checkout-only five-key map,
lockfile, original test/old81 bytes, all native E0/B001 actual API/owned tuple,
worker, EOF, cleanup, atomic append, caps, budgets, selection and T0-T3.
There are still **two** distinct prepare sourceFiles passes, **11** source
paths and **16** upload paths. All **10** prior/frozen input SHA-256 claims
match current raw bytes. All **57** historical archive files match baseline;
archive tree-row SHA-256 is
`cb15965730dad49aa8d1f138ef0014eff975b96447c93f2e866e9e39721548b3`.
The frozen original test hash is
`7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`.
These are byte-identity checks, not old81 execution or renewed acceptance.

## Captured evidence and transport

Exact manifest entry sets were checked before opening authorized parent paths:
Planner **20 / 97,696 bytes**, pre-scope **3 / 68,899 bytes**, original native
capture **7 / 37,590 bytes**. All lengths/hashes and external/local/committed
copies match. Full entry hashes and authority-file hashes are in the ledger.

Captured JSON binds run **38165950837**, attempt **1**, job **114548428887**,
source712, failure and artifacts **0**. Its log has exactly one P11 payload.
Install, synthetic checks, INITIAL, verification and upload were skipped;
seal failed in a separate invocation. P11 proves only the validator/assertion
interval, not validator false alone, a unique cause, or native execution.
Displayed runner Image is not an observed `process.env.ImageOS/ImageVersion`
value. Timestamped GitHub records are not a raw Windows stderr guarantee.
No network query, rerun or new native evidence was obtained here.

## Error and execution boundaries

Only focused shell reads/static Git and newly authored inline Node builtin
reads, byte/hash calculations, JSON-as-data and literal string analysis ran.
No candidate/proposal/test/prior analyst script import, compilation, eval,
VM, fixture, probe, npm, installer, native/OS PID/kill, network, GH, SSH,
Docker or DB activity. Node's stdin wrapper stack in the checker error is not
candidate VM execution. No Generator or other unauthorized agent worktree
was read; the explicitly commissioned Planner/pre-scope reports were inputs.

One read-only checker initially expected 13 total reason writes, omitting
the two S2 writes. Its complete first command/output/exit 1 is immutable in
the raw ledger. Correcting the assertion to 15 produced a distinct exit 0
invocation, explicitly not a reconstructed or relabeled first output. The
main whole-tree/reversal/transport checker passed on its first invocation.
No target file or target state changed because of the checker error.

Only this report directory was authored with absolute apply_patch paths.
No source/state/features/pending_gate/memory/registry/harness edits, push or
amend. Compose remains **HARD_STOP** with no third attempt; keys remain
deferred; no backup/restore/baseline/password work; `release_ready=false`.

Different-family exact-source support remains a separately commissioned
gate. No source712 rerun, further source712 Kimi, new-source observation,
publication/CI/native or release authority follows from this result.
