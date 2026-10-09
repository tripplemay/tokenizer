# BL-WINDOWS-P1-STAGES: fixed-marker P1 staging proposal

## Status and authority

- Supporting Planner under `harness-rules.md` section 1.5; not an active-batch transition, implementation, Evaluator signoff, or release verdict.
- Planning base: `570a16ed75717f8c107b4c99667227cc0c04b0d5` in the isolated `tokenizer-windows-p1-stage-plan-20261009` worktree.
- This delivery adds only this specification, `docs/test-reports/BL-WINDOWS-P1-STAGES-plan-20261009/plan.json`, and that directory's `README.md`.
- `release_ready=false`, `release_acceptance=false`, `formal_F005_claim=false`.
- No native execution, CI submission, GitHub/SSH/Secrets/production access, push, state-machine change, or memory update is authorized by this document. Implementation and publication require separate scope approval and independent review.

## 1. Verified starting point, not a root-cause finding

Read the frozen CLI `docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs` and the independently authored `native-parity-findings-r2/{README.md,analysis.json,original-sha256.json}` in the same directory. The latter binds actual run `37822555762`, job `113467034986`, execution ref `719c2df0d54f62b1b3b3e711a2045ffd8ea5e711`.

Offline rechecking at this planning base confirmed all 59 inventory entries (121007 bytes) retain their recorded SHA-256. The existing CLI, trace preload, three inspected product files and dedicated workflow retain the hashes in `plan.json`. This is downloaded-byte consistency, not signed remote authenticity or complete runtime attestation.

Decisive facts:

1. All ten P0 fixed-marker children completed. All ten separately launched P1 children using `[void](ConvertFrom-Json '[1,2]')` returned `BoundedSubprocessTimeoutError` after the configured 7000 ms native deadline. The reported 7182.766-7193.561 ms includes worker/termination/response overhead, not JSON conversion time.
2. Every P2 and all eight downstream roots were not reached; no arm was selected. There were 20 smoke PowerShell admissions, zero downstream admissions, and no combined environment arm.
3. The five trace-on records show worker kinds `ok`, then `timeout`; no P1 native stream-byte event occurred. Neither the old trace nor the guard recorded cmdlet, module, or JSON milestones.
4. `bounded-subprocess-worker.mjs` returns only `{kind:'timeout'}` on a successful timed-out cleanup; `bounded-subprocess.ts` throws and does not return native stdout/stderr. Merely adding PowerShell markers and examining `runBoundedSubprocess()`'s result will therefore lose timeout prefixes.
5. Workflow SUCCESS / diagnostic exit 0 records a complete diagnostic refusal observation; it is not Windows product PASS. Original cleanup and health consistency does not prove an entire remote process tree absent, and does not accept unexecuted replay/queue/privacy behavior.

The earliest uncertainty remains inside P1. Cmdlet resolution, discovery, autoload/initialization, and conversion are competing hypotheses, not established causes. This proposal must not select a product repair or extend the old deadline.

## 2. Frozen boundaries and one permitted observation delta

The existing parity CLI, old `trace-preload.mjs`, original native artifacts/reports, `src/cli/**`, existing tests/fixtures, dependencies, workflows, harness/rules, and all state/memory files remain byte-frozen. Do not append stage observations to the old parity protocol, broaden its validators, change its exit semantics, rerun it as part of this proposal, or relabel its historical evidence.

A later approved Generator may create a **new** P1-only diagnostic CLI and new diagnostic-local checks/output under a separately approved new path. It may reuse/copy the existing guard with a reviewable observation-only extension; it may not patch the frozen worker to return timeout stdout. Exact paths and changed-file allowlist must be locked before implementation. No workflow edit is presently approved.

The declared observation delta has two parts, both visible in the future diff:

- Fixed `-Command` strings insert synchronous ASCII console writes/flushes and, only in named refinements below, one fixed PowerShell operation. No host/environment/argument fallback is added.
- A new diagnostic-side guard listener on the **already admitted owned PowerShell stdout** parses only exact fixed lines and immediately records safe stage enums in the owned guard log. It shares the old output/log/lifetime bounds. It does not consume or replace the worker/trace listeners and does not change worker result construction, timers, cleanup or product error classes.

Replacing the guard import URL in `NODE_OPTIONS` with the new diagnostic guard is an explicit instrumentation change. Synthetic owned path instances necessarily differ from the old run. These are not hidden environment fixes. `old-trace-on` still loads the unchanged old trace; common guard is always on. This is neither uninstrumented parity nor full original-runner environment parity.

## 3. Exact environment, argv, budget and cleanup contract

Only **E0 / old-trace-on / common-guard-on** is proposed. No E1-E4 expansion, full environment inheritance, combined arm, extra key, profile, registry/config search, or environment dump.

- Inherit only the existing E0 system keys: `PATH`, `SystemRoot`, `WINDIR`, `ComSpec`, `PATHEXT` (case-insensitive source lookup as in the frozen CLI).
- Keep synthetic owned `HOME=USERPROFILE`, `TEMP/TMP/TMPDIR`, empty Git config/prompt guards, existing owned root/counter/health/lifetime variables, and `TW_PARITY_KIND=smoke`, `TW_PARITY_CASE=smoke`. No `APPDATA`, `LOCALAPPDATA`, `SystemDrive` or `PSModulePath` addition. Do not add a selector environment key: identify each new variant by its fixed owned case ID and exact constant script at admission.
- Native executable and argument layout stay `powershell.exe`, `['-NoLogo','-NoProfile','-NonInteractive','-Command', FIXED_SCRIPT]`, `shell:false`, `windowsHide:true`, with the same bounded worker path and cwd/inheritance behavior. Only the explicitly listed `FIXED_SCRIPT` operand changes. No `pwsh`, absolute executable substitute, encoded command, child wrapper, interactive mode or alternate invocation via a resolved CommandInfo object.
- Preserve `ConvertFrom-Json '[1,2]'` exactly, `[void]` suppression, `$ErrorActionPreference='Stop'`, and the original final literal `'TW_PARITY_JSON_V1'` in every JSON variant. No array pipeline, pre-parsed JSON, alternate serializer, cached result or warmed parent PowerShell process.

| Bound | Unchanged ceiling |
|---|---:|
| Whole diagnostic | 600000 ms |
| Owned case | 40000 ms |
| Case/global cleanup-output allowance | 3000 ms |
| Existing product operation ceiling | 10000 ms |
| Each native child, including all stages together | 7000 ms |
| Smoke / total PowerShell launches | 38 / 76 |
| Case stdout+stderr | 65536 bytes |
| Each guard/trace evidence stream | 524288 bytes |
| Native stdout+stderr and counter evidence | 16384 bytes |

The new fixed plan has at most **six** native PowerShell launches, all counted as smoke. Every variant uses a fresh owned root, fresh Node bounded worker and fresh PowerShell; no in-process reuse across variants. Unused capacity is not permission for retries, extra controls, arms or downstream cases.

At case admission retain the same `40000+3000` remaining-time test and `used+requiredPs` checks; requiredPs is exactly one per new case. After setup re-admit. At native launch retain timeout validation, remaining `timeoutMs+3000` allowance, counter-before-spawn, asynchronous worker supervision, and rejection of synchronous PowerShell launches. Unknown counter/clock/provenance aborts, rather than speculating or borrowing time.

Retain owned live-handle tree termination, existing worker/parent watchdog allowances, final bounded return, separate guard/trace health, observed-PID checks, and retained-root behavior when cleanup is unknown. Never signal historical evidence PIDs or scan by executable name. Child close and sampled liveness do not prove whole-tree absence. Stage prefixes never override cleanup/trace/provenance unknown, output overflow, or guard abort.

## 4. Minimal fixed markers and ordered single-variable experiments

Marker writes are exactly `[Console]::Out.WriteLine('FIXED_ASCII_TOKEN'); [Console]::Out.Flush();`. They avoid adding a `Write-Output` cmdlet to the diagnostic path. They still perturb execution and require the writer control below. No values, module objects/names/paths, environment, JSON result, exception message or native stderr is printed by the diagnostic scripts.

Nine new tokens suffice: one writer control and one before/after pair for each of four separately bracketed operations. The existing `TW_PARITY_JSON_V1` is the unchanged terminal success literal, not an extra internal milestone.

| Token | Safe enum | Exact bracketed operation |
|---|---|---|
| `TW_P1_STAGE_V1_WRITER_OK` | `writer-ok` | Console writer only, no cmdlet/JSON |
| `TW_P1_STAGE_V1_JSON_ENTER` | `json-enter` | Immediately before original `[void](ConvertFrom-Json '[1,2]')` |
| `TW_P1_STAGE_V1_JSON_DONE` | `json-done` | Immediately after that call returns |
| `TW_P1_STAGE_V1_LOOKUP_ENTER` | `lookup-enter` | Before `[void](Get-Command -Name ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop)` |
| `TW_P1_STAGE_V1_LOOKUP_DONE` | `lookup-done` | After that lookup returns |
| `TW_P1_STAGE_V1_DISCOVERY_ENTER` | `discovery-enter` | Before fixed Get-Module discovery of the one machine-only utility manifest below |
| `TW_P1_STAGE_V1_DISCOVERY_DONE` | `discovery-done` | After that discovery returns |
| `TW_P1_STAGE_V1_LOAD_ENTER` | `load-enter` | Before fixed Import-Module of that same machine-only manifest |
| `TW_P1_STAGE_V1_LOAD_DONE` | `load-done` | After that explicit load returns |

`Get-Command` can include command lookup and automatic module loading. The lookup pair is therefore named **lookup-or-autoload envelope**, not proof of a pure lookup phase. `Get-Module -ListAvailable` adds a separate discovery operation, not an internal callback from the original invocation; `Import-Module` is an explicit-load refinement, not the original autoload path. Looking up the diagnostic cmdlets themselves can also be part of their respective intervals. Do not pretend these markers expose PowerShell internals more narrowly than the fixed calls they bracket.

### Initial minimal slice (T0-T3 only, no module probe yet)

| ID | Fixed script construction / single delta | Admission and expected sequence |
|---|---|---|
| T0 `writer-control` | `$ErrorActionPreference='Stop';` followed only by the writer-ok write/flush | First. Exactly writer-ok, successful worker status 0/signal null, zero native stderr |
| T1 `original-p1-control` | Byte-exact original P1 string from frozen CLI line 597, no stage writes or extra operation | Only after T0 complete; on success exactly original terminal literal, on timeout a clean empty prefix is allowed |
| T2 `direct-invoke` | T1 with json-enter before and json-done after original conversion | Only after T0 complete and T1 observable; fixed prefix of json-enter, json-done, terminal |
| T3 `lookup-refinement` | T2 plus only the lookup-enter / fixed Get-Command / lookup-done block before json-enter | Only if T2 has a trustworthy json-enter but no json-done, and a clean bounded timeout/refusal; expected lookup-enter, lookup-done, json-enter, json-done, terminal |

T1 is a cold comparator under the **same new recorder**, not a rerun of the old complete parity CLI. T0 verifies the new console writer/recorder on a child without cmdlet/module/JSON work. T1-to-T2 changes only fixed marker insertion. T2-to-T3 changes only the bracketed lookup operation; that operation may warm module state **inside T3 only**. A T3 success after T2 timeout is perturbation evidence, not an original P1 repair.

If T2 succeeds, stop after T2; the old timeout did not reproduce under this observation form. If T2 never emits its first marker, or writer/stream/trace/cleanup is unknown, stop at that earlier uncertainty. If T3 finishes lookup but not JSON, do not broaden to discovery: the lookup envelope completed and the later invoke remains unresolved.

### Conditional module refinements (T4-T5, separately gated)

T4/T5 are **not part of the initial implementation/publication scope by default**. They require explicit approval of this conditional module refinement and independent review of its selector/scripts before any immutable diagnostic that includes them is launched. No human interaction or approval wait is inserted inside the 600 s run. An initial-only run always skips T4/T5; a broader conditional scope, if approved before launch, may admit them only after its same-run T3 prefix passes the locked safe-prefix checks below. No second diagnostic inside the same run resets the counters or clock. If the initial-only run already finished, a later module investigation needs a new exact scope; this proposal does not authorize replaying T0-T3 or silently starting another budget.

| ID | One delta from previous variant | Additional gate / expected sequence |
|---|---|---|
| T4 `discovery-refinement` | T3 plus only discovery-enter / fixed machine-only Get-Module / discovery-done before lookup-enter | T3 trustworthy lookup-enter without lookup-done; discovery pair, lookup pair, JSON pair, terminal |
| T5 `explicit-load-refinement` | T4 plus only load-enter / fixed machine-only Import-Module / load-done between discovery-done and lookup-enter | T4 discovery-done observed but lookup-done absent; discovery pair, load pair, lookup pair, JSON pair, terminal |

The conditional refinement's exact target is derived only from already allowed `SystemRoot`, not from runner module search paths or personal directories:

```powershell
[void](Get-Module -ListAvailable -Name ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop)
[void](Import-Module -Name ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop)
```

These are candidate fixed probe operations, not a claim this manifest's existence or Get-Module return content has been verified on the runner. Discovery-done proves only that the suppressed call returned, not that a module was found. No target substitution, name-search fallback, real personal path enumeration, object/path output or module identity assertion is permitted. The environment remains E0; explicitly loading a machine-only manifest is an intentional **command-operation** delta, not E4/full machine parity or original autoload behavior. E4, any other manifest path, or identity/path assertion is a different future scope. No alias/function replacement, module removal, `$PSModuleAutoLoadingPreference` modification, explicit JSON cmdlet qualification or profile import is allowed here.

Every skipped variant records `rootProcessStarted=false`, `nativeLaunches=0` and an allowlisted reason: `writer-control-not-complete`, `prior-observation-unknown`, `direct-invoke-complete-no-refinement`, `lookup-complete-invoke-unresolved`, `module-refinement-not-approved`, `discovery-not-complete`, or the unchanged diagnostic budget-admission reason. No exception swallowing to reach later stages; one child call's Stop/timeout ends that child's script. P2, parent hooks, confirmation, binding and healthy aggregate analogs are always excluded, even if JSON succeeds.

## 5. New stdout and guard allowlists: explicit, strict, timeout-safe

The old guard accepts only its existing event schema; the old smoke validator accepts only P0/P1/P2 values and final marker equality. **Neither currently permits the new events.** A future new diagnostic must define its own strict validator rather than silently widening those frozen validators.

Required new allowlist/guard changes, limited to the new diagnostic:

1. **Admission identity:** accept only the exact executable/prefix argv and six locked constant script strings, with a fixed owned case-ID mapping. Reject arbitrary `-Command` content and mismatched case/script. This metadata is derived from already allowed worker argv, never exported as raw argv or native paths. Stage events only attach to the corresponding admitted live PowerShell child handle, not other Node/Git/taskkill streams.
2. **Fixed line parser:** attach before the worker/trace listeners can receive data; process Buffer chunks without changing stream encoding or consuming their data. Accept only exact ASCII tokens above plus the original terminal literal for that variant, each followed by LF or CRLF. Support tokens split at any chunk boundary. Reject BOM, other whitespace, non-ASCII, extra empty lines, unknown text, duplicates, reordered/inapplicable tokens and unterminated final fragments. No substring search or `.trim()` acceptance.
3. **Bounded memory/output:** use a bounded line buffer, with a fixed maximum token length plus CRLF and the original combined 16384-byte native stdout/stderr cap. Count all bytes, including rejected bytes and markers, and preserve the worker's existing cap behavior. Overflow/unknown stream content never produces a raw fallback artifact. New event bytes remain inside the unchanged 524288-byte guard cap; no second log grants another allowance.
4. **Immediate safe event:** on each valid complete line append a strictly rebuilt `native-fixed-stage` event with only the existing guard base `{pid,sequence,at}` and `{childPid,variant,marker,ordinal,arrivalElapsedMs}`. `variant` is T0-T5, `marker` is a listed safe enum including `terminal-json`, ordinal is the exact variant sequence position, PIDs are positive bounded integers, and arrival elapsed is finite/nonnegative within the case lifetime. No raw token field, stdout string, JSON/module value, path or exception text.
5. **Independent stream health:** emit one `native-fixed-stream-end` event containing the same guard base, childPid/variant, capped integer stdoutBytes/stderrBytes, acceptedMarkers (0-9), EOF-observed boolean, and exact enum state/reason. States: `complete-sequence`, `complete-prefix`, `invalid`, `unknown`. Reasons: `none`, `unexpected-bytes`, `order-or-duplicate`, `unterminated-line`, `native-output-cap`, `stream-error`, `eof-not-observed`. Any nonzero native stderr makes stream state invalid; only its byte count is retained. Incomplete sequence with clean EOF is a prefix, not conversion success. A destroyed stream/close without EOF is unknown, not complete.
6. **Root protocol:** only safe stage enum arrays, exact bounded counts/timings, native outcome/status/signal/safe product error class/code, script SHA-256, admission/health/cleanup booleans and fixed not-observed/skip reasons are exported. New root validator must rebuild exact key sets, sequence, case/script identity and launch count. It must independently reconcile stream events with guard ownership, worker outcome and trace health. No original raw native bytes, error message or serialized object is embedded.

Native markers are persisted from the new guard **before** the unchanged worker may return `timeout`; the root reads the validated owned guard log afterward. Timeout does not require the worker to return partial output. A synchronous `runBoundedSubprocess` caller cannot implement this by polling its own event loop while it is blocked.

There are at most nine accepted lines in T5 (eight internal markers plus terminal) and one in T0. No accepted marker renews a timer, changes cleanup, creates a new launch or permits later invocation. If the new log write/health fails, use diagnostic evidence failure; do not salvage a product PASS. Existing safe error-code handling remains unchanged; new parser reasons live only in the new enum schema, not product errors or old `SAFE_CODES`.

## 6. Interpretation and negative controls

Report `observed` and `not-observed`, not `unreached`, for internal milestones. A received enter without done brackets a returned-data gap; it does not prove the cmdlet began executing, identify a blocked syscall, exclude recorder overhead, or prove the operation never completed before cancellation. Arrival elapsed is observer time, not PowerShell CPU/JSON timing. No first marker is insufficient to conclude startup failed.

Keep `diagnostic_observation_complete`, `prefix_protocol_valid`, `native_completed`, and `release_acceptance` separate. A trustworthy timeout prefix may constitute a complete observation of a failed child; no JSON/module success is implied. Any unknown trace/provenance/cleanup or invalid stream makes diagnostic observation incomplete. JSON success does not select a P2/downstream arm and never closes Windows release gates.

Before any native publication, independent new diagnostic-local checks must cover:

| Negative/control input | Required result |
|---|---|
| Every possible ASCII marker chunk split, LF/CRLF, coalesced lines | Same exact enum sequence; no raw bytes exported |
| Valid prefix then simulated worker timeout and clean EOF | Prefix retained, native_completed=false, remaining milestones not-observed; no worker/product patch |
| Valid prefix then destroy without EOF / stream error / missing health | Evidence unknown; never stage success or cleanup proof |
| Unknown/BOM/non-ASCII/blank/extra literal, raw/credential/stderr canary, unterminated fragment | Strict invalid stream, safe enum-only failure, no raw artifact or native error message |
| Duplicate, reverse order, skipped-middle or wrong-variant valid token | Protocol failure even though token is globally allowlisted |
| Token emitted by Node/Git/taskkill, wrong child handle/PID/case/script | Not accepted as a PowerShell stage; fail identity if applicable |
| Exact 16384 and +1 combined native bytes; exact trace/case caps and +1 | Same inclusive caps as frozen design; overflow incomplete/aborted, no new allowance |
| Missing/corrupt/over-cap counter, 38/76 boundary, insufficient case or native cleanup allowance | No PowerShell launch, explicit admission failure, no counter reset/retry |
| Ordered native result but guard/trace health false, root forced/metadata unknown or possible-live owned PID | Independent incomplete/cleanup-unknown flags retained; root retained under original policy |
| T1 or T2 success, T3 completed lookup, T4 failed discovery, unapproved T4/T5 | Exactly the declared stop/skip decision, zero skipped child/root launches |

These are future parser/guard/selection controls using isolated synthetic data or mocks, not added native experiments and not permission to edit existing tests. The only new native negative comparator is T1's exact original P1; T0 is the writer positive control. No intentional native sleep/hang/output flood, canary output or extra timeout child is included in the six-launch plan.

## 7. Evidence required for a later handoff

Before implementation: approve exact new files, initial T0-T3 scope, script constants, new guard/event/root schema and negative checks; preserve protected-tree hashes. A conditional T4/T5 inclusion must be explicitly approved before the immutable run, never added after a timeout during that run. Before native publication: independent scope review plus separate Coordinator-controlled non-main authorization. No worker pushes any branch.

For a later native artifact, retain immutable execution ref, new CLI/guard/script hashes, dependency lock hash, frozen file hashes, actual command/Node22/OS/arch/runner-image versions, original E0 key **names** and change categories only, fixed case decisions, admitted counts, safe stage arrays, guard/trace health, root/cleanup unknown flags, and `release_ready=false`. Do not output raw env, personal module paths/profile or secrets. PowerShell version was not recorded in the old run; any future version capture needs an explicitly reviewed safe fixed field and must not add a PowerShell launch to this plan.

Keep original run `37822555762` evidence and new output directories separate. `source_freeze_head=7c6936b...` is not the content identity of the added parity CLI, which did not exist there. No later docs commit may be presented as having executed the old native run. The current plan commit likewise has no native runtime evidence.

Unresolved: true PowerShell version, original autoload/initialization internals, whether the new recorder changes the observed timeout, command/module provenance under E0, full environment/old-trace causal parity, aggregate five-second failure, parent swap, confirmation/binding/privacy/healthy queue behavior, full process-tree absence, and all release gates. Resolve the earliest trustworthy interval first; any changed time budget, machine-only module path, extra arm, product repair or downstream test needs a new scope.
