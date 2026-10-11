# Windows P1 provenance failure: PLAN_ONLY

Fresh supporting Planner `windows_provenance_failure_planner`, harness-rules section 1.5. Source frozen at `712cf210b089dc71f3a6e6ed2e19e1de7fee57da`; report-only local branch. No Generator, Evaluator, Coordinator, implementation, execution, publication or release authority. The existing `building` status is not a role grant for this independent task.

## Outcome

The available originals identify **P11, not a unique root cause**. Keep the failed run, source and original bytes. Do not rerun source712 or dispatch its sole Kimi supplement again. A new observation needs fresh pre-scope and a separately authorized exact-source Generator, fresh post-scope and different-family gate, then a separate Coordinator ruling. This plan does not grant any of them.

The original generic failure is 51 ASCII bytes and the original fixed phase line is 29, including LF: **80 bytes are already occupied**. Keeping both unchanged, all P00-P12 markers and P11's meaning leaves no room for another nonempty reason line within 80. The preferred existing-contract disposition is therefore **no implementation / no extra observation**. `proposal.json` separately proposes an unapproved independent 84-byte contract, using one four-byte `V00`-`V17` line only for a failing exact prepare invocation at P11. It cannot be implemented under the prior 80-byte authorization.

## Original evidence and source identity

`evidence/input-ledger.json` independently records all seven transport-manifest entries, actual byte lengths and SHA-256 equality, the manifest and adjudication, local source closure and decoded pattern bytes. `evidence/originals/` preserves complete exact bytes; no source original was rewritten. The seven entries total 37,590 bytes; manifest hash must match `038bf22a6be697c6cf5eb62885c29919e7d181e0627e8c8fcd96cbfe0def93ea`. The manifest is an integrity claim, not an authority; equality was recomputed independently. `SHA256SUMS` covers all report files except itself; `manifest.json` inventories the pre-manifest report payload. No manifest claims to hash itself or a future commit.

The first exact `git add` returned exit 1 because three `.log` copies were ignored; a subsequent local report commit initially contained only 14 files. The complete first error and continuation are preserved in `evidence/failure-ledger.json`. No amend or force-add was used. Only the three self-generated copies were renamed to `.txt`, with identical bytes and an explicit `evidence/original-copy-map.json`; the external originals were untouched. The initial manifest is retained separately; the current manifest supersedes its copy-path inventory. A second report-only commit completes the bundle.

Original jobs/final JSON binds run `38165950837`, attempt `1`, job `114548428887`, source712 and failure. Checkout and setup-node succeeded; dependency installation, synthetic checks and INITIAL were skipped. Seal failed, verification/upload were skipped, artifacts count is zero. Full log lines 145-148 preserve generic failure, the one P11 payload and exit 1. Seal lines 149-154 belong to a separate invocation and do not establish the cause of prepare. The captured log is timestamped GitHub transport, not a raw Windows stderr delivery guarantee. Nothing establishes T0-T3/API/worker/EOF/cleanup/E0 evidence or F004/F005/release acceptance.

## Exact call boundary

At `p1-stages.mjs:735-739`, the second `sourceFiles()` pass returns into `prepareSourceFiles`, P11 is assigned, and `assert(validateProvenance(provenance, prepareSourceFiles, executionSha))` executes before P12 and `writeJson`. P11 can be an exception escaping `validateProvenance`, or `false` followed by the unchanged assertion throwing. It is not a validator false-only attestation.

`validateProvenance:694-703` calls `rebuild('provenance', value)` once. `rebuild:89-91` calls the recursive `schemaMatches:59-88`, then JSON stringify/parse only if schema matches; it catches schema/clone exceptions and returns null. Therefore rebuild-null merges schema false and internally swallowed exceptions. The outer first guard returns false on null, SHA relation mismatch or full sourceFiles comparison mismatch. Subsequent checks, in order, compare exact sorted paths, every frozen SHA, binding SHA, and the system/synthetic environment-key relation with no extra keys. Later helper exceptions escape to the dispatcher. No validator invokes native/worker code. Prepare retains two distinct sourceFiles read/hash passes; do not remove, cache, merge, retry or move either.

### Confirmed or source-relative inference

- Direct originals: exact run/source binding, one fixed P11 log payload, prepare/seal exit 1, skipped later work, artifact count zero; setup-node reports Node `v22.23.3` / npm `10.9.9`.
- Exact-source control-flow inference only: P01-P10 returned before P11, including platform/arch/Node22/event/ref/SHA guards, binding/frozen checks, bounded checkout checks, SystemRoot guard, scratch parent/creation, provenance construction and both owned source reads. This is not an emitted Windows hash/environment/provenance measurement or separate passing-stage acceptance.
- P11 is before the prepare write, so that invocation did not reach its `writeJson`; P12 output/schema/file-write errors do not explain this P11.
- The schema enforces strict object/field types, 11 source entries, 27 maximum unique environment keys, fixed constants, SHA/hash formats and runtime patterns. Local static paths/constants/counts and expected hashes are in the ledger, not substitutions for run-time values.

### Excluded claims

- Not an import-time uncaught failure before main dispatch, nor a P01-P10 throw, under the observed exact-source flow.
- Not installed-package/synthetic/native execution failure as the direct P11 operation; those steps did not run. Their absence does not prove later behavior would pass.
- Runner image `windows-2025-vs2026` and displayed image version are **not** `process.env.ImageOS` / `process.env.ImageVersion`. No imageOS mismatch or schema widening is proved.
- The test fixture uses `imageOS: 'win25'`; it is synthetic and cannot attest the real Windows environment. No test/fixture/regex/provenance execution was performed here.

### Unknown and surviving counterexamples

- Actual `uv`, `osRelease`, ImageOS/ImageVersion, run-id/attempt provenance values and complete provenance were not captured. Runtime-schema false is possible, including missing/invalid environment-backed fields; an internal schema/serialization exception also survives the coarse evidence.
- SHA equalities were checked earlier, but the later compound validator and clone outcome were not emitted. Object/array schema validity, first/second read equality, all later relations and a thrown validator operation are not individually observed.
- Frozen hashes were checked earlier, and both sourceFiles calls returned, but returned bytes/digests and between-pass equality were not captured. Do not invent a mutation or infer its impossibility from a clean local tree.
- A schema-valid input with unequal sourceFiles, a schema-invalid runtime field, and an internally caught schema/clone exception all map to the same old P11. They are logical counterexample classes, **not generated or executed fixtures**. Thus captured inputs do not support a unique replayable cause or a repair.

## Scope and replay boundary

The passive ledger command only reads allowed files, parses JSON as data, computes byte lengths/hashes, inspects literal bytes and copies originals into this report. It never imports/compiles/evaluates the target, executes tests/fixtures/VM/native code, calls network/GH/SSH/Docker/DB or probes processes. Initial HEAD/status were source712 and clean. Git checks use `git -c core.fileMode=false`; only this report is added and committed with `--only`. No push/amend/state/memory/registry/harness/pending_gate changes.

For independent passive replay, read the manifest and the nine allowed originals in `evidence/originals/`, recompute each length/hash and compare `evidence/input-ledger.json`, then inspect exact source712 lines 59-99, 694-740 and 1097-1116 and schema definitions at binding JSON lines 170-176. Do not execute the candidate or create synthetic provenance. The original run cannot be rerun and this report contains no authorized execution recipe.

Compose remains HARD_STOP with no further attempt. User keys remain deferred; no backup/restore/baseline/password work. `release_ready=false`.
