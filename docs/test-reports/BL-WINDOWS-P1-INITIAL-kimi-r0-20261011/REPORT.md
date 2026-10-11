# BL-WINDOWS-P1-INITIAL-SUPPORT — independent Evaluator report (kimi-r0)

- task_id: `windows-p1-initial-888a5ac-kimi-r0` · role: fresh independent registered Kimi-family supporting Evaluator (harness-rules §1.5)
- date: 2026-10-11 · host: macOS (OFFLINE synthetic/mocked scope only — no live native/API/OS claims)
- source HEAD verified: `888a5acd7a8a441c9ec4ad898453f149cf8d6b7c` (`git rev-parse HEAD` at evaluation start)
- scope: NEW Windows P1 INITIAL diagnostic only (F004 support). NOT a retry/acceptance of the HARD_STOP Compose chain, NOT original Windows repairs, NOT native PowerShell, NOT formal F004/F005, NOT release. `release_ready` stays false; no progress/features/pending_gate/memory writes performed.

## 1. Identity and frozen-input verification (all mechanical, all match)

| item | expected | result |
|---|---|---|
| HEAD | 888a5acd7a8a441c9ec4ad898453f149cf8d6b7c | match |
| CLI `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | sha256 3a2d4174…70a4346b | match |
| test `tests/diagnostics/windows-p1-stages.test.ts` | sha256 7718f1e6…e289132 | match |
| workflow `.github/workflows/windows-p1-stages-diagnostic.yml` | sha256 94aa4fa7…4bd962b | match |
| binding JSON embedded in CLI (`bindingHash` ed24ebf3…) | actual file sha256 | match |
| binding MD embedded in CLI (`mdHash` bf60ca42…) | actual file sha256 | match |
| 3 prior inputs (STAGES spec, plan.json, scope verdict.json) | JSON-locked sha256 ×3 | match (6df78199…, c9ae43fb…, dded8038…) |
| 7 frozen runtime sources (parity/trace/bounded-subprocess/worker/replay/old workflow/package-lock) | JSON-locked sha256 ×7 | match |
| 4 case script SHA-256 (T0–T3) | `validateBindings()` re-derivation | match |
| only three new source paths | `git show --stat` of 0f02b81+888a5ac vs bindings `future_added_source_paths` | match; zero existing-file edits (`git status --porcelain` shows ONLY my two allowed write paths) |

## 2. Environment (owned, isolated)

- Node v22.22.0 from `/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`; PATH prepended with `/usr/sbin:/sbin`.
- `HOME=USERPROFILE=/Volumes/ORICO/project/.wp1ke-r0-20261011`, `TMPDIR=…/tmp`, npm cache `…/npm-cache` — all owned dirs, no real home/system temp/queues.
- Fresh `npm ci` in this evaluator worktree: real `node_modules` dir (not symlink), **exit 0**; full stdout/stderr/status preserved (`npm-ci.*`). Deprecation warnings only; no `audit fix`, no dependency edits. Public npm registry was the only network target.

## 3. Executed checks (raw artifacts in this directory, immutable per run)

| run | command | result | artifact |
|---|---|---|---|
| existing 81 controls | `node node_modules/vitest/vitest.mjs run tests/diagnostics/windows-p1-stages.test.ts --reporter=json` | **81/81 pass, exit 0** | `existing-81.raw.json/.stdout/.stderr` |
| own probes run1 | same runner on `tests/evaluator/windows-p1-initial-r0-probes.test.ts` | 45/46 (1 fail) — **probe-author error**, see §5 | `own-probes.run1-PROBE-AUTHOR-ERROR.*` |
| own probes run2 | after boundary-input correction | 45/46 (1 fail) — same error class, second boundary | `own-probes.run2.*` |
| own probes run3 | after second correction | 46/46 pass, exit 0 (file later changed type-only) | `own-probes.run3.*` |
| `npm run verify` run1 | `prisma generate && tsc --noEmit` | exit 2 — TS2493 in MY mock signature (type-level only) | `npm-run-verify.run1-TYPE-ERROR.*` |
| `npm run verify` run2 | after widening mock params | **exit 0** | `npm-run-verify.run2.*` |
| own probes run4-final | final bytes sha256 `545be5ac…d69e5c` | **46/46 pass, exit 0** | `own-probes.run4-final.*` |

Totals: **127 scoped checks green (81 existing + 46 own additive), verify exit 0.** No test of the implementation was edited; implementation hashes unchanged after all runs. No giant duplicate suite (own file is 46 compact table-driven probes across 8 describes) and no broad unrelated regression was run.

## 4. Mechanical inspection — all 14 locked groups (`required_future_controls`)

1. **all-token-chunk-splits-and-LF-CRLF** — `createRecorder` byte loop (p1-stages.mjs:241-266): LF/CRLF terminators, split anywhere, 29-byte pending bound. Existing describe#1 covers every split position + byte-at-a-time for all 4 variants × LF/CRLF. OWN adds: exact 29-vs-30-byte pending boundary distinguishing `unterminated-line` vs `unexpected-bytes`; marker arriving with observer elapsed > 40000 ms → `stream-error`/unknown; EOF order across streams irrelevant; post-finish feeds dropped (exactly one stream-end).
2. **timeout-prefix-immediate-safe-persistence** — stage persisted synchronously inside the listener (`persist` at :259, before any timeout construction). Existing describe#2 proves prefix persisted before a mock timeout discards stdout and no duplicate stream-end at close/finalization. OWN confirms prefix-timeout cases stay `native_completed=false` through `evaluateCase`.
3. **missing-EOF-event-health-or-stream-error** — `finish()` state machine (:272-282): missing either `end` → unknown/`eof-not-observed`; `close`/destroy alone insufficient. Existing describe#3 (+health-stream independence). OWN adds T2 clean-timeout prefix with missing stderr EOF → `prefix_protocol_valid=false`, selection `stop-unknown` (no T3 launch), root retained.
4. **unsafe-bytes-canaries-stderr-and-order** — reasons `unexpected-bytes`/`order-or-duplicate`/`unterminated-line`; stderr-any invalid; rejected bytes counted; first violation kept (overflow precedence :246). Existing describe#4 covers BOM/blank/space/canaries/non-ASCII/NUL/CR/duplicates/reorder/wrong-variant/oversize.
5. **handle-pid-case-script-identity** — `matchNativeIdentity` (:285-297) exact caseId-basename/worker path/payload/argv/options/positive PID; `attachNativeRecorder` additive Buffer listeners only (:298-310). Existing describe#5: 9 mutation counterexamples + listener non-interference + wrong-handle null.
6. **all-inclusive-caps-and-plus-one** — `countBytes` saturating combined 16385/per-stream 16384 (:132-137); gate inclusive `size+candidate<=cap` exact allowed (:194-195). Existing describe#6: 16384/16385/32768, 65536 root, exact 524288 guard/trace, cap+1 read rejection. OWN adds: counter transaction at exact 16384 (348 whole rows) admitted, +row crossing refused, file unchanged, lock released; oversized 16385 counter unreadable.
7. **concurrent-append-and-lock-failure** — single atomic `mkdirSync` lock, no spin/wait/retry/takeover, fail-closed on contention/identity/partial/release/read (:180-211); old trace captures gated append via `installAppendWrapper`+`syncBuiltinESMExports` (:225-233). Existing describe#7 + OWN: throwing candidate-build leaves bytes untouched and releases the lock; fixed safe throw codes per target (`TRACE_IO_OR_SERIALIZATION` for trace, `GUARD_LOG_IO_OR_LIMIT` otherwise) with exact-path `onFailure`.
8. **counter-and-clock-admission-boundaries** — `caseAdmission` (:138-142) requires remaining ∈ [43000, 600000], used+1 within 38/76/4; `nativeAdmission` (:143-151) exact 7000, remaining ≥10000 inclusive, counter-before-spawn. Existing describe#8 + OWN: usedTotal=3 admitted vs 4 denied at the INITIAL max4 ceiling; smoke>total corrupt → `unknown-native-budget`; inclusive 10000/43000 boundaries re-proven (see §5).
9. **cleanup-trace-provenance-independent-unknown** — `healthTrust`/`rootTrust`/flag independence in `evaluateCase` (:529-565); no terminal marker overrides an unknown. Existing describe#9 + OWN: EPERM/EACCES/ENOSYS/UNKNOWN/missing-code on the OWNING ROOT pid at either sample → cleanup unknown, retained, no progression (existing suite only exercised pid 300).
10. **every-selection-row-zero-skipped-launches** — `selection()` (:566-578) and `validateSequence` (:934-948) implement the JSON table once; skipped ⇒ `rootProcessStarted=false/nativeLaunches=0`, unknown ⇒ nulls. Existing describe#10 + OWN: consistent `launch` outcome preserved as launch yet never progressed; fully-unknown record set yields null counts/exit code in `makeSummary` without fabricated zeros.
11. **strict-extra-key-rejection** — `schemaMatches` enforces `additionalProperties:false`, exact required keys, canonical line equality (:43-72). Existing describe#11 + OWN: four impossible native tuples (not-started-with-status, not-started-with-workerKind, output-with-code, completed-with-status-3) rejected to `unknown` at the schema boundary.
12. **import-without-side-effects** — main/guard entry only via `?guard=1` or `argv[1]===self` (:1064-1085). Existing describe#12: fresh import performs no spawn/spawnSync/append/mkdir.
13. **exact-source-workflow-and-upload-file-set** — `validateBindings` hash-locks MD/JSON/prior inputs/frozen sources/scripts; workflow file matches locked JSON (push-only branch, job-if, contents:read, cancel-in-progress:false, windows-latest, Node22, 12 min, checkout github.sha depth1 persist-credentials:false, six ordered commands, seal `if:always()`, upload gated on seal+verify success, 16 explicit paths, retention 7, if-no-files-found:error, no dispatch/PR/schedule/secrets/environment/powershell.exe in workflow). `verifySealedDirectory` (:1027-1056) enforces the exact 16-file set, 15-entry manifest (no self-hash), digest/byte equality, canonical public streams. Existing describe#13 + OWN: six provenance mutations refused; 16/15 shape constants; positive canonical provenance acceptance (11 source files).
14. **B001 actual-API-source closure** — `nativeFromApi` derives source ONLY from actual `runBoundedSubprocess` return/catch instances (:580-599); `workerFacts` requires exactly one admitted powershell spawn per guard+trace, unique owning worker, all four child-exit/child-close facts present/unique/mutually equal, spawn-sync-is-Node-only (:448-478); `reconcileNative` equality for api-return, kind-by-outcome for api-throw, never copies throw-path close facts (:479-494). Existing describe#14: 11 contradictory-tuple counterexamples ×T1/T2 + 5 timeout-fabrication rejections + positive rows + API-instance-only derivation. OWN adds: completed-return contradicted by any single one of four facts (incl. per-pid sequence corruption) → unknown/stop-unknown; canonical timeout with owned SIGKILL facts keeps status/signal null yet completes observation (positive reconciliation); T2 EOF-missing boundary blocks T3.

## 5. Initial failures and corrections (all in MY OWN probe file; implementation never touched)

1. **own-probes run1, 1 failure** (`freezes 10000ms…`): my probe asserted denial at `deadline-now == 10000`. Binding MD §2 says native admission requires remaining **>= 10000 ms** — inclusive — and the existing suite's own boundary test (test file :363-364) confirms the implementation's `deadline-now < 7000+3000` comparison. Implementation correct; my expectation was off-by-one. Legitimate correction: changed denial probe to `now:1, deadline:10000` (9999 remaining) and kept exactly-10000 as the admitted row. Run artifacts preserved as `own-probes.run1-PROBE-AUTHOR-ERROR.*`.
2. **own-probes run2, 1 failure**: identical author error on case admission (`remaining == 43000` is admitted inclusively per the same sentence in §2; existing suite :360-361 agrees). Corrected the same way. `own-probes.run2.*` preserved.
3. **`npm run verify` run1, exit 2**: TS2493 — my mock launcher was typed as a 2-tuple while I destructured 5 call args (type-level only; runtime probes already green). Fixed by widening the mock's optional parameters; no implementation or assertion change. `npm-run-verify.run1-TYPE-ERROR.*` preserved; run2 exit 0.
4. Final green run4 re-executed against the final probe-file bytes so the PASS corresponds to the delivered file (sha256 `545be5ac…`).

No retry-to-green: each run's raw JSON/stdout/stderr/status is a separate immutable artifact; every correction is in the evaluator-owned test file only, with the failure class (probe authoring, not product defect) stated.

## 6. PS001 / PS002 / PS003 independent repair checks (not assumed from 81 green)

- **PS001 sealed skipped-stream bypass** — `loadSealedCaseEvidence` (:976-987) requires skipped public streams to be ACTUAL empty bytes (`bytes.length === 0`) AND every public stream to be canonical actual bytes (`bytes.equals(Buffer.from(stream.text))`). OWN probes: a schema-VALID canonical non-empty row sealed into skipped T0–T3 guard AND trace streams under a refreshed, fully valid 15-entry manifest is rejected for all 8 variant×family combinations, and no sealed file is rewritten (byte snapshot equality before/after). A whitespace-noncanonical valid-JSON line is likewise rejected; scratch-side suppression of the same bytes is a distinct safe-empty rebuild (`parseRows` marks it invalid; existing VM test proves scratch files untouched). PASS.
- **PS002 sampling uncertainty** — `runCase` `sample()` (:831-839) treats any non-`ESRCH` `process.kill(p,0)` error (incl. missing code) as `samplingUnknown` → `cleanupUnknown` → `rootRetained`, no removal, no progression; `ESRCH` alone is recognized absence. OWN probes exercise the ACTUAL extracted `runCase` body in a test-local VM (unchanged source slice, mock FS/clock/PID only): EPERM/EACCES/ENOSYS/UNKNOWN/undefined-code raised on the owning root PID 100 at either of the two samples (later sample all-ESRCH) → exactly six signal-0 queries, one mocked launcher call, cleanupUnknown+retained+stop-unknown, provenance stays known; all-ESRCH positive control completes observation and removes the root. PASS.
- **PS003 missing-EOF retention + runRoot symbol** — `evaluateCase` (:557-563) forces `cleanupUnknown`/`rootRetained` whenever stream state is unknown or any EOF flag is false, without erasing parser-invalid facts. OWN probes: `unterminated-line` invalidity + either missing EOF carried through the actual `runCase` body keeps the stream event byte-identical (`toEqual`), retained, incomplete, stop-unknown. The `runRoot` symbol: `runParent`'s local `const runRoot` (:892) shadows only inside `runParent`; `runCase` takes `runDirectory` and calls the module-level `async function runRoot` (:765,:828). OWN launcher-args probe PROVES the actual root-path symbol reaches the mocked launcher: first call args are exactly `(caseRow, join(runDirectory, caseId), fixedEnvironmentResult, min(now+40000, deadline-3000), deadline)`, and `fixedEnvironment` independently receives the same root/run-root pair — not merely evaluateCase fixtures. PASS.

## 7. Limits of this acceptance (local, not native)

- Host is macOS; `--prepare/--run/--probe/--seal/--verify-upload` CLI modes were NOT executed (they hard-require win32 x64 + GitHub Actions env); no `powershell.exe`, no real `process.kill` queries against live processes, no old diagnostic, no native CI. Assertions about native behavior rest on pure imports of the exact exported functions, test-local VM evaluation of the unchanged `runCase`/`loadScratchCaseEvidence` source slices, and mock ChildProcess/Buffer/FS/clock/PID data — precisely the sanctioned offline boundary.
- Runner provenance (`assertWindowsRunner`, `checkoutSha`, GITHUB_* binding), actual clean-EOF availability on a real runner, observer perturbation, whole-process-tree absence and the original PowerShell internal cause remain unverified by design; all release gates stay open; `release_ready=false`; no whole-tree absence claim.
- Lint: `npm run lint` not in scope for these paths (script covers `app src` only) — stated truthfully; `npm run verify` (prisma generate + tsc --noEmit) run instead and green (run2).
- Coordinator transport validation, native CI, and any parent F004/F005 acceptance are outside this task.

## 8. Conclusion

Within the assigned OFFLINE synthetic/mocked scope, the NEW Windows P1 INITIAL diagnostic at HEAD 888a5acd passes independent acceptance: identity/hashes exact, 81 existing controls green, 46 own additive probes green, verify green, all 14 locked groups mechanically inspected and functionally exercised, PS001/PS002/PS003 repairs independently confirmed, scope discipline intact (only three new source paths; only my two allowed write paths added). **PASS (offline scoped) for feature F004 support.**
