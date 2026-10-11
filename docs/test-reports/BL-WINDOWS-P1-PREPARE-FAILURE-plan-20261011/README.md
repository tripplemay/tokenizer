# Windows P1 opaque prepare failure: supporting plan only

- Author: fresh supporting Planner `windows_prepare_failure_planner`, not Coordinator, Generator or functional Evaluator.
- Analysis source: `61cf64e67a6fda231bb090e77c19d5ececb908af`; isolated worktree `tokenizer-windows-p1-prepare-failure-plan-20261011`.
- Original runtime: run `38160000449`, attempt 1, job `114530720469`, exact-source push on the fixed non-main diagnostic branch.
- Outcome: **the available evidence does not identify one failing prepare branch or one root cause**. No implementation, retry, environment repair, test/native execution, publication or release approval is granted.

## Evidence and provenance

`evidence.json` records independently read original run/jobs/artifacts/log fields and byte/hash captures. The six in-scope manifest entries (publication, run-list, final run, jobs, artifacts, full log) match the original transport manifest in both bytes and SHA-256. The watch file is outside this commission and was not read or claimed verified. Manifest/adjudication hashes are separately captured, not self-authentication or functional evidence. Coordinator adjudication was read as an untrusted assertion, not used to establish the root cause.

The four C002 source files' local raw hashes equal their exact source61 Git blob hashes. Ten `validateBindings` prior/frozen input hashes, four decoded ASCII script hashes, case order/count and 29-byte pending-line binding also agree locally. These are passive author-side checks, **not Windows byte observation, target-module execution or independent acceptance**.

Originals remain at:

`/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008/docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/`

No prior checkout/identity-failure original was changed, relabeled or rerun. No originals were copied into the sealed upload protocol.

## What the captured runtime establishes

The original jobs JSON reports checkout/setup-node success, prepare failure, skipped dependency install/synthetic checks/INITIAL, seal failure, and skipped verifier/upload. Original artifact count is zero. Full log lines 138-139 report Node `v22.23.3` and npm `10.9.9`; this is not a local-version substitution. Log lines 142-147 and 148-153 show the exact prepare/seal commands, the same generic message and exit 1.

Checkout log lines 36-38, 52-56 and 115-116 show the requested ref/inputs, five step-local configuration env entries and checked-out source61 identity. The five entries are `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`, `GIT_CONFIG_KEY_1`, `GIT_CONFIG_VALUE_1`; COUNT=2 denotes two Git configuration pairs. `with.ref`, `fetch-depth`, `persist-credentials` are three separate inputs. The action log does **not** expose effective conversion settings or per-file raw hashes.

Source-relative control-flow proof (not an emitted Windows hash): the unique generic message is in `p1-stages.mjs:1079`, inside the main dispatcher catch. Reaching it requires normal evaluation of the static dependency and the module's top-level binding read, SHA assertion and JSON parse at lines 19-21, plus the remaining top-level setup, and selection of the non-guard main entry at lines 1064-1067. Thus, under the captured source61 execution identity, the import-time binding assertion did not abort this invocation. Merely saying "the prior assertion is absent" would be weaker; claiming the log directly measured Windows file bytes would be false. No assertion inside the caught prepare body is thereby proven to have passed. The exact `--prepare` branch follows the served command and static dispatch; process.argv itself is not emitted, so the generic catch alone is not an argv attestation.

`native-runtime-parity.mjs` imports only Node builtins. Its bottom guarded main entry is not selected when imported by `p1-stages.mjs`; it does not invoke its old native diagnostic on this import. The prepare import graph does not need npm packages. Product TypeScript/tsx loading is confined to later probe/run paths; missing installed dependencies is not a demonstrated prepare prerequisite failure.

## Ordered reachable failures, with no invented pass

All entries below are **possible** unless expressly marked source-relative proof above. They are not assigned likelihood or promoted to a root cause.

| Order / source lines | Existing operation / rejecting conditions | Runtime certainty |
| --- | --- | --- |
| 1 / 688-694 | Windows/x64/Node22 check; push/ref check; 40-lowercase-hex GITHUB_SHA check | Runner/job/version context is compatible, but no individual process guard result is logged. |
| 2 / 76-84, 694 | Raw Markdown hash; three prior + seven frozen input reads/hashes; four cases and script hashes; token bound; variant order | All passive local values agree; Windows execution/reachability of each is unknown. No normalization or second accepted hash is allowed. |
| 3 / 667-676, 695 | Existing bounded `git rev-parse` and scoped `git status`; launch/error/status/signal, exact stdout/stderr and clean-path checks | Checkout action Git success is earlier/different; diagnostic Git invocation/results are not emitted. Both commands inherit the parent process env. No Git fixture was run. |
| 4 / 695 | Execution SHA equals GITHUB_SHA | Checked-out SHA is recorded; completion of this diagnostic equality is unknown. |
| 5 / 320-327, 696 | Case-insensitive lookup of five permitted system keys; duplicate spelling or non-string value rejects | No raw env was read in this analysis or emitted by the run. No inherited keys are repaired. |
| 6 / 697 | SystemRoot must be a local-drive absolute prefix | Its existence/value/result is unknown. No SystemDrive/APPDATA/LOCALAPPDATA/PSModulePath repair is proposed. |
| 7 / 155-164, 698 | Every ancestor is a non-symlink directory, exact realpath equality, final directory identity | Lstat/realpath errors, alias/case/reparse/type violations may reject; actual paths and identity results are unobserved. |
| 8 / 698 | One nonrecursive mkdir of the exact scratch path | Existing path, access/IO/parent failure may reject. Scratch creation or absence is not proven by generic output/artifact count. |
| 9 / 699-705, 663-665, 617-629 | Provenance construction and first sorted eleven-file owned read/hash pass | Read cap (1 MiB), regular file/nlink/symlink, parent identity, fd/path identity, exact read/size/close conditions may reject. These sources are read as bytes, not imported. Which file/check was reached is unknown. |
| 10 / 706 | Second identical eleven-file owned read/hash pass | Same possible failures or changed snapshot; no single-pass optimization allowed. |
| 11 / 678-686, 706 | Provenance schema, expected/execution SHA and exact source list/hash identity, fixed env-name list and empty extras | Missing/ill-shaped runId/attempt/runtime fields, UV/OS/image schema, any snapshot/hash/source/env-name mismatch can reject. The generic message gives no field. |
| 12 / 653-657, 707 | Rebuild schema, canonical bytes/canary and 65536-byte cap, one exclusive provenance write | Schema/serialization/cap/canary/IO/existing file failure is possible; no completed provenance artifact is available. |

The runtime schema requires `imageOS` matching `^win[0-9]{2}$` and `imageVersion` matching `^[0-9]{8}\\.[0-9]{1,8}\\.[0-9]{1,8}$`. Log lines 16-17 show runner image `windows-2025-vs2026` and version `20260925.250.1`, **not** `process.env.ImageOS` or a completed provenance object. Image naming is not proof of an ImageOS mismatch. Do not widen its schema, pin/change the runner, add a runtime query or infer a unique environment repair.

Seal is an independent later invocation with a shared prefix (`assertWindowsRunner`, `validateBindings`) and additional scratch/check/evidence prerequisites at lines 988 onward. Its generic failure may be caused by the same early guard or by missing/incomplete prepare/check data. It cannot establish which prepare operation ran/passed, whether scratch exists, or a common unique cause.

No T0/T1/T2/T3, PowerShell marker/API/worker/EOF/cleanup/atomic append observation was produced. A step being skipped is not a native negative result. Nothing here closes Windows/F004/F005 or any release gate.

## Strict minimum successor proposal

`proposal.json` specifies one **prepare-only** terminal failure line containing only a fixed phase enum `P00`-`P12`. It adds no query, retry, command, import, native launch, file or upload. It intentionally does not reveal raw error type/message/code, stack, paths, env values/names, stdout/stderr content or hashes. A coarse failed interval may still contain several causes; another narrower proposal would then need its own fresh gate. No presumed root-cause repair is bundled.

The line is exactly 29 ASCII bytes including LF; at most one added line per failing exact prepare invocation. Retain the existing 51-byte generic message and exit 1, so maximum terminal catch output is 80 bytes; successful prepare and all other modes get no new output. The fixed-output membership/length/once invariant is separate from the unchanged native/output budgets. Missing/truncated observation is unknown, never a pass.

Only a separately accepted successor scope could authorize the listed observation slots in the existing new diagnostic CLI. C002 itself permits only its checkout/hash projection; it does **not** already authorize these new CLI bytes. Existing JSON/Markdown hash literals, specs, tests, workflow, old CLI/trace, product sources and originals remain frozen. No additional sourceFiles/upload path is admitted.

Next gates: fresh passive supporting pre-scope on this precise projection; then, only after separate authorization, exact Generator patch; fresh actual-diff/post-scope and different-model-family supporting gate on exact candidate with negative controls; finally separate Coordinator ruling for any single new-source CI opportunity. This report grants none of those actions. Source61 retry-to-green, automatic publication and automatic follow-up native execution are forbidden.

## Execution/author limitations

Only explicit scoped file reads, jq static parsing, SHA-256/byte counts and read-only Git source/status/diff were used. Network synchronization/startup auto-registration were skipped because the commission forbids network/state/registry mutations. No target source import, VM, diagnostic CLI, npm, test, native/PowerShell, Git fixture, GH authentication, push, HOME enumeration, key, SSH, Docker or DB operation occurred. All shell commands used this isolated worktree; all Git commands had `-c core.fileMode=false`; all manual edits used absolute apply_patch paths inside this new report directory.

`failure-ledger.json` retains one initial jq compile error (exit 3), its exact command/error and corrected independent static result. Broad initial static listings/read output were truncated by display budgets; focused reads replaced them without modifying any input. One conversation statement misread "five keys" as two Git configuration pairs; corrected terminology above matches the exact source/log and is retained in the ledger. No manual path error or target execution occurred.

Progress remains `building`, role assignments/pending_gate null and `release_ready=false` in the read baseline. State/registry/harness/memory were not changed. Compose HARD_STOP/no third Compose, deferred keys, no backup/restore/baseline/password/deployment and no branch push remain unchanged.
