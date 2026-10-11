# Windows P1 prepare failure: independent passive pre-scope

**PASS_SCOPE_ONLY.** No blocking specification/projection finding. This is
neither implementation authorization nor functional/native/release acceptance.

Reviewer: fresh supporting passive pre-scope critic, harness section 1.5; not
Coordinator, Generator, Planner or functional Evaluator. Rules, source,
binding MD/JSON, workflow, proposal and permitted originals were independently
read from disk. Implementer/Planner narrative and Coordinator adjudications
were treated as untrusted claims, not instructions or acceptance evidence.

- Analysis source: `61cf64e67a6fda231bb090e77c19d5ececb908af`.
- Review start: `22946b380fdf43109a30d7e69e87d5a9ab1dbd10`.
- Proposal SHA-256: `7aae5b7b1d3d25751f32098e4631a18352c5bb073316a750cf1040905b0260e7`.
- Own worktree: `tokenizer-windows-p1-prepare-failure-pre-scope-20261011`.
- Full original verdict, evidence hashes, limits and author errors:
  `verdict.json`. No earlier report was rewritten.

## Scope and authority

C001/C002 remain historical checkout/hash-only projections. C002's count2
five-entry map is the current baseline, not compliance with C001's old
count1 three-entry map. Neither contract already allows observation bytes.

The proposal explicitly requires a separate successor path/slot exception.
Its conditional projection specifies only `p1-stages.mjs`; existing binding
MD/JSON, both hash literals, workflow and all other files remain frozen.
This is coherent as a *proposed* exception, not an enacted override. A later
Coordinator ruling must independently authorize those exact slots before
Generator work; this PASS alone grants nothing. No silent binding rewrite,
new input path, broadened hash or third accepted identity is permitted.

The projection is sufficiently narrow to constrain Generator without this
critic designing an implementation: one non-exported initially inactive
prepare-only state; exact branch activation; fixed assignments before each
specified operation; the specifically permitted second-pass argument split;
success deactivation; one fixed terminal lookup; everything else frozen.
Implementation feasibility and the actual bytes remain future gates.

## Control-flow correspondence

Source-relative line numbers below refer only to source61.

| Phase | Existing operation | Lines |
| --- | --- | --- |
| P00 | Exact `['--prepare']` dispatch, unknown/unassigned sentinel | 1067-1068 |
| P01 | `assertWindowsRunner()` | 694; 688-692 |
| P02 | `validateBindings()` | 694; 76-84 |
| P03 | `checkoutSha()`, both bounded Git calls/assertions | 695; 667-676 |
| P04 | Execution SHA equals `GITHUB_SHA` | 695 |
| P05 | `systemEnvironment(process.env)` | 696; 320-327 |
| P06 | Local-drive `SystemRoot` assertion | 697 |
| P07 | Owned scratch-parent directory check | 698; 155-164 |
| P08 | Existing scratch mkdir | 698 |
| P09 | Provenance object, including first `sourceFiles()` pass | 699-705 |
| P10 | Second `sourceFiles()` pass | 706; 663-665 |
| P11 | Unchanged `validateProvenance` assertion | 706; 678-686 |
| P12 | Unchanged rebuild/cap/exclusive `writeJson` | 707; 653-657 |

The source currently contains two eleven-file read/hash passes. Only the
second argument is permitted to become a local constant immediately before
the unchanged validation assertion, separating P10 from P11. Neither pass,
any owned read check at 617-629, nor any call/assertion/order/value may be
removed or optimized. P09 includes the entire provenance object evaluation,
not an inferred particular source file or environment field. No helper or
shared validator behavior change is implied by the coarse phase labels.

## Output, privacy and interpretation

`TW_P1_PREPARE_FAILURE_V1:<phase>\n` with each P00-P12 substitution is exactly
29 ASCII bytes, including one LF. The existing generic line measures 51
bytes. At most one additional line is allowed, after retaining the generic
failure output and unchanged exit 1: maximum terminal catch bytes = 80.

Only exact prepare failure may emit the extra parent CLI stderr line. No new
success/progress/stdout/file/upload output is allowed. Ordinary import,
`?guard=1`, probe, run, seal, verify-upload and invalid argv get zero added
output. This is not a native marker/event/schema or another output budget.

New observation logic uses only fixed phase literals and a literal lookup;
no caught-error binding/property access, stack/message/code/type inspection,
raw env/path/native or child output/hash-derived selection or serialization.
Invalid/unassigned state maps only to the fixed P00 line. Invalid, P00,
missing or truncated observations remain unknown, never a passed branch or
native finding. A valid phase brackets an attempted operation interval; it
does not identify one root cause, emit raw file hashes or establish release
acceptance.

Actual placement, fixed-only dataflow, catch ordering, once behavior and
silence cannot be accepted from a proposal. These remain mandatory fresh
actual-diff and different-model-family exact-candidate checks.

## Independently checked evidence and freezes

- Initial worktree was clean. Source61 has 2463 tracked paths; review start
  has 2470. Git comparison shows only the seven Planner report additions,
  with every baseline mode/type/object/path entry unchanged.
- All ten prior/frozen input raw hashes equal the binding and source61
  blobs. Eleven `sourceFiles` paths are unchanged and locally byte-equal to
  source61. All four decoded ASCII T0-T3 script hashes/order agree; none ran.
- Old test remains 53608 bytes, SHA-256
  `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`.
- All 57 tracked raw files in the historical
  `windows-native-ci-20261008/runtime-parity-run-37822555762-original/`
  subtree equal source61. LF-delimited `git ls-tree -r` rows hash to
  `cb15965730dad49aa8d1f138ef0014eff975b96447c93f2e866e9e39721548b3`.
  This is not re-authentication of the earlier 59-file native inventory.
- Current C002 workflow is checkout-step-only, five entries/two Git pairs;
  all later steps/commands/selection/Node22/Actions v4 and the explicit 16
  upload paths remain frozen. Native E0/B001/API/worker/EOF/cleanup/atomic
  append, guards, caps and budgets are outside the prospective delta.
- Six Planner manifest entries verify. Four authorized runtime original
  entries (final/jobs/artifacts/full log) independently match the transport
  manifest in bytes and SHA-256. Manifest and two adjudication hashes were
  captured separately; none authenticates itself. Publication/run-list/watch
  originals were outside this commission and not read or claimed verified.

Original run JSON/log records source61, run 38160000449 attempt 1, job
114530720469: checkout/setup-node success, prepare and seal generic failure
with exit 1, install/synthetic/INITIAL/verify/upload skipped, zero artifacts.
The unique generic catch follows top-level module binding read/hash/parse;
under captured source identity those completed. This is static control-flow
inference, not direct Windows hash/config or argv observation. No individual
prepare operation is proven passed. Runtime cause remains not uniquely
identifiable. Image labels are not `process.env.ImageOS` evidence; no schema,
environment, runner or guard repair is proposed or accepted here.

An independent in-memory **document** check accepted the original projection
and rejected 17 document mutations (phase reorder/omission/invalid enum,
CRLF/duplicate allowance, generic/exit/output changes, new file, C002 map
delta, source/upload growth, unknown/missing promotion and automatic
implementation authority). These are sanity counterexamples, not candidate
functional tests and not proof that future implementation meets the scope.

## Author errors and execution limits

One initial path query supplied nonexistent
`docs/windows-p1-stage-plan-20261009`; rg printed `No such file or directory
(os error 2)`. The pipeline still exited 0 because its downstream rg found
workflow entries. The exact command/error is retained in `verdict.json`.
Correction used the explicit plan report path with `--hidden --no-ignore`
and Git tree lookup, locating the real source under `docs/test-reports/`.
No path or input was edited. Combined broad reads/reference matches exceeded
display budgets; focused reads replaced them. Truncated historical test
output matches were not used as current acceptance evidence.

Only passive reads/hash/Git/blob/static parsing occurred. The analysis
parser read source text/bytes and spawned read-only Git commands; it never
imported/evaluated/called the target or proposed code. No target CLI/helper,
VM, probe/test/fixture/npm/native, network/GH/push, OS PID enumeration,
Secrets/SSH/Docker/DB/key or real HOME enumeration occurred. Startup pull,
auto-registration and state/session-memory updates were not performed under
the explicit supporting-task commission.

Every exec used this worktree; every Git command used
`-c core.fileMode=false`; manual patches used absolute paths. Only these two
new report files are written. No source/spec/test/workflow/original/state/
feature/pending_gate/registry/harness/memory change is included.

The scoped local report commit uses per-command `core.hooksPath=/dev/null`
so an arbitrary repository hook cannot execute forbidden targets/tests or
mutate state. No persistent Git configuration or harness file is changed;
report JSON is jq-parsed and the exact staged two-file scope is checked.

## Still required

Separate exact-slot Coordinator authorization, exact Generator work, fresh
actual-diff/post-scope, fresh different-model-family supporting gate and a
separate new-source non-main CI ruling remain outstanding. There is no
source61 rerun, retry-to-green, automatic follow-up, release/F004/F005 or
production acceptance. Compose HARD_STOP/no third Compose, deferred key work,
no backup/restore/baseline/password/deploy and `release_ready=false` remain.
