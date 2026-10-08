# Windows release-gate technical diagnosis

## Scope and result

Supporting read-only diagnosis under harness-rules.md section 1.5, not Generator
repair and not independent formal release acceptance. Candidate:
`76d916ba2e3a7147acda5ac9ef15fa70a9cd9958`. No product, old test, workflow,
progress/features, memory, Secret, production or human-gate changes were made.
All additions are in this report directory. No branch was pushed.

**F004 remains failed; release_ready=false.** The native CI has a real privacy
negative-control failure, two subprocess contract failures, and three aggregate
5-second test timeouts. Do not label all eight as fixture errors. Conversely,
refusal-message mismatch and aggregate timeout alone do not prove unsafe
admission or an operation-wide 10-second deadline failure.

There is no Windows host in this diagnostic session. New probes are unexecuted
on Windows. Local Node 22.22.0 `--check` is syntax-only, not native verification.
Prior reports/narratives are not evidence of these failures or their resolution.
The separately dispatched Kimi preflight Evaluator's independence is unaffected.

## Evidence and provenance

Actions run [37803611472](https://github.com/tripplemay/tokenizer/actions/runs/37803611472),
Windows job [113401991277](https://github.com/tripplemay/tokenizer/actions/runs/37803611472/job/113401991277).
Coordinator downloaded original files, retained byte-for-byte here:

| File | SHA-256 |
| --- | --- |
| ci-37803611472-windows-original.log | 1d6ccd9641c573f1de858ef723e75f59ba662b5c3f80505e6b80cfa0a22fdb4e |
| ci-37803611472-windows-full-job.log | e219e8c1f8c9d8cebb7ef3b4c6d8f1b6c79dccb9a3d614e6b4f3a0e4fa2f7ec2 |
| ci-37803611472-windows-job.json | 0db15d6495e6562c85473407cb6d87dda710faa5b79bf9075b3858bb48d54098 |
| ci-37803611472-run.json | 2ea3fea417d7e21b2fd41701eccabd6b3522a58afa766ab6a1f68cfb097c0856 |

Full job lines 80-94 confirm exact checkout SHA; 103/107-108 identify Node
22.23.3, npm 10.9.9. Lines 10-19 identify Windows Server 2025 10.0.26100,
runner image `windows-2025-vs2026` version `20260925.250.1`. Unit log line 10
identifies Vitest 4.1.11. Lines 644-645: 6 failed files, 8 failed tests,
1887 passed, 144 skipped, 2039 total. The runtime is not an old Windows baseline.

Run metadata also records Linux, macOS launchd, PostgreSQL 16 and authenticated
browser jobs as success, OCI/recovery rehearsal and deploy as skipped. Those
job-level facts are not reproduced or independently accepted by this diagnosis.
The dedicated Windows force-termination and install.ps1 syntax steps after unit
tests were skipped; upload-step success does not mean those checks ran.

## Failure-by-failure mapping

### W01 - workflow static extraction receives only a newline

- **Confirmed:** unit log 514-531 fails at `vps-host-preflight.test.ts:271`;
  received `\n`, expected the preserved release-operation guard.
- **Source:** test lines 270/283 look for exact LF job headings. Workflow lines
  227 and analogous other release jobs do contain the guard. `.gitattributes`
  pins report/history files, not this workflow.
- **Hypothesis, not measured checkout bytes:** CRLF means `indexOf('  verify:\n')`
  is -1; `slice(-1)` returns the final newline. This precisely explains the
  symptom without an actual workflow guard removal. CRLF also affects the
  host-preflight slice and inventoryStep's exact LF step markers (64-69), which
  were Windows-skipped, so fixing only the first assertion is insufficient.
- **Diagnostic:** `workflow` records raw CRLF count, exact heading index and
  extracted length for checkout bytes and in-memory LF/CRLF forms. No workflow
  file is rewritten. If native bytes are LF, investigate missing heading or
  checkout mismatch rather than accepting this explanation.

### W02 - afterRead parent replacement yields generic safe-open refusal

- **Confirmed:** unit log 534-540 reports `Replay refused: source could not be
  opened safely`, not `source parent changed`. afterPathStat variant passed;
  afterRead variant failed in 496 ms (290-299).
- **Source flow:** replay.ts:198 initial parent/native reparse check; :205
  parent-only check; :209 file handle open; :214 parent-only check; :225 hook;
  :228 parent/native check; :169 parent identity comparison. The hook renames
  the directory, creates a replacement and hardlinks the same leaf (test :30).
  A non-prefixed exception anywhere in the reader or hook becomes :247's
  generic refusal. An already-prefixed parent refusal is rethrown unchanged.
- **Inference:** the replacement may fail at rename/mkdir/hardlink with the
  leaf handle open, or the second native PowerShell supervision may fail. The
  log does not tell which, and the following `reached` assertion never runs
  after the message assertion fails. Do not assert the swap completed or the
  identity guard was bypassed. The observed reader refused; admission was not
  attempted by this test.
- **Important constraint:** generic 'Windows locks open files' is not enough.
  Node 22.23.3's bundled libuv normally opens files with READ/WRITE/DELETE
  sharing. Native directory rename behavior must actually be measured.
  [Exact Node source](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/win/fs.c#L431-L445).
- **Diagnostic:** `parent` retains both stages with separate hookReached and
  hookStep, wrapping real rename/mkdir/link/lstat/fstat/open and native check
  subprocesses. Record exact errno and pre/post parent identities, without
  changing errors to satisfy the original assertion.

### W03 - three final confirmation negatives exceed aggregate 5 seconds

- **Confirmed:** original :48 test timed out; unit log 296 reports 6241 ms.
- **Source:** one preview plus three executions; each execution first inspects
  and then rereads after current-config callback. Seven reads total if all
  three negatives reach final binding, with two native PowerShell checks per
  read on Windows: up to 14 launches. All functions are synchronous; each
  preview/execution has its own 10-second operation deadline.
- **Inference:** repeated PowerShell startup and worker startup/IPC can exceed
  Vitest's aggregate 5-second default while each operation remains bounded and
  refusals correct. No stage timings or merge-call count were emitted for the
  failing test, so those safety assertions remain unverified in this run.
- **Diagnostic:** `confirmation` measures preview/projectRoots/mode/same-size
  mutation separately, counts real native subprocesses, reports refusals and
  mergeCalls. Keep 10-second product deadlines and original tests unchanged.

### W04 - ordinary-file descendant admitted by privacy scope filter

- **Confirmed product behavior:** unit log 558-580 returns the original
  `regular\child` event at :70, although `regular` is a regular file created
  by the fixture. This is the second loop item, not the junction cycle. The
  first item's event and rule assertions completed; the second rule assertion
  at :71 was not reached. Priority: privacy fail-closed regression, investigate
  before fixture/time-budget work.
- **Exact source candidate branch:** privacy.ts:44 joins missing suffixes onto
  any native realpath success. :46-58 strips a component only when realpath
  and lstat both throw ENOENT. There is no requirement that the resolved
  ancestor be a directory. If Windows returns ENOENT for `regular\child`,
  fallback reaches `regular`, realpath succeeds, and the nonexistent child
  is lexically under the included root. :68 sees no null and :71 admits it.
- **Not yet native-traced:** the specific realpath/lstat errno sequence. The
  returned invalid descendant and source acceptance gap are established; the
  Windows errno explanation is a hypothesis, not a fixture excuse. A working
  POSIX ENOTDIR control would not override this Windows observation.
- **Diagnostic:** `privacy` separately probes regular-child as event and rule,
  cycle, broken-junction descendant and ordinary missing directory descendant
  positive control. Trace real native errno and ancestor type. Preserve event
  identities and wire bytes. No queue/upload action in this probe.

### W05 - replay confirmation binding exceeds aggregate 5 seconds

- **Confirmed:** unit log 584-594 timeout; :245 reports 6598 ms.
- **Source:** original test :152-179 is preview, bad digest, privacy mode,
  scope and grown-file invalidation. Its successful full path performs seven
  reads / up to 14 native checks, plus Git enrichment on initial eligible rows.
  Two executions reject only after final re-open; bad/grown digest paths still
  inspect first. All are synchronous; a single Vitest test spans them.
- **Inference/diagnostic:** same aggregation hypothesis as W03, not a proven
  safe outcome. `binding` records analogous separate stages, including original
  foreign POSIX workspace/include-path semantics on Windows, and mergeCalls.
  New probe uses smaller bounded fixture budgets and changes neither old tests
  nor the normal privacy filter. Treat it as branch evidence, not original-test
  acceptance; exact original case must be rerun later without weakened checks.

### W06 - inherited-pipes fixture returns before timeout

- **Confirmed:** unit log 597-606 says no exception; :340 reports 432 ms,
  below the 500 ms child deadline. Thus original PID-count and poll assertions
  were not reached. Returned status, bytes and both PIDs' liveness are absent.
- **Source:** worker :84-89 accepts ordinary child close as ok; successful
  completion does not call killTree. The original fixture :24 spawns another
  Node process non-detached with inherited stdio; :25 exits the parent at 200 ms.
- **Strong platform/fixture hypothesis:** bundled libuv assigns non-detached
  spawned children to a parent-owned kill-on-close job. Therefore this Node
  parent may kill its own Node descendant on exit and legitimately close pipes
  before 500 ms. A later timeout is not necessarily the expected Windows
  behavior for this particular fixture.
  [Exact Node 22.23.3 libuv job initialization and spawn assignment](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/win/process.c#L65-L79),
  [assignment/error fallback](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/win/process.c#L1016-L1034).
- **Still open:** if the descendant is live after ok, this is a supervision/
  pipe ownership defect, not a fixture success. Job assignment can have an
  access-denied fallback; source alone cannot prove CI's actual job membership.
  [Microsoft job-object semantics](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- **Diagnostic:** unchanged fixture plus trace records parent/descendant spawn,
  exit/close, returned kind/status and liveness immediately and 100 ms after
  return, then after the independent 15-second cap. If both are dead, add a
  separately reviewed native non-libuv parent/shared-handle control that proves
  a descendant heartbeat after parent exit; do not simply flip the old assertion,
  skip Windows, or introduce detached descendants as a substitute safety claim.

### W07 - combined overflow becomes cleanup supervision error

- **Confirmed:** unit log 609-627 receives BoundedSubprocessSupervisionError
  with `subprocess cleanup failed`, not BoundedSubprocessOutputError; :342
  reports 272 ms. The following exact 1200-byte success assertion did not run.
- **Exact decisive source:** this message can only arise from result.kind
  supervision at bounded-subprocess.ts:104. Worker :56 rewrites any non-ok
  reason if killTree returns false. Windows killTree :37 demands taskkill status
  0, and :49 demands successful && closed. An outer watchdog/protocol problem
  would instead say `subprocess supervision failed` or worker deadline exceeded.
- **Strong race hypothesis:** original combined writer emits 600+600 bytes
  and exits naturally. Output crossing at :63 may race its exit/close and
  taskkill startup; taskkill can fail because the child has already exited.
  A genuine taskkill error or missing close is also possible. This is a product
  classification/cleanup-observability issue until native events distinguish
  already-exited from failed cleanup. Do not blanket accept all nonzero taskkill
  statuses or downgrade a live descendant's cleanup failure to output error.
- **Diagnostic:** unchanged 1024/1200-byte variants and long-lived overflow
  canary control; trace both stream byte counts, child exit/close, taskkill
  launch/error/exit/close and worker result.kind. On this run, the long-lived
  overflow, resistant/descendant cleanup and real taskkill controls did pass
  (unit :339-343), which narrows but does not prove the short-lived writer race.
  [Microsoft taskkill PID and tree parameters](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).

### W08 - healthy Git replay sequence exceeds aggregate 5 seconds

- **Confirmed:** unit 630-640 timeout; :428 reports 6436 ms. Original body
  initializes Git, commits, adds a synthetic credentialed remote, runs preview,
  then execute via an outer Node/tsx probe. The final minimized queue assertions
  were not verified by this timed-out case.
- **Source:** preview has one read, execution has two reads; each Windows read
  has two native reparse checks. Separate child probes each import product and
  start a cold Git cache: four Git calls per ordinary repository inspection
  (git.ts:65-81), up to eight across preview and execute, plus three setup calls.
  Outer test run() has a 13-second child budget but original test has a default
  aggregate 5-second budget. Neither changes the product's 10-second deadline.
- **Diagnostic:** `healthy` starts a synthetic Git repository with a synthetic
  credential canary, records preview/execute times, read-only preview queue
  hash, retained backlog and absence of message/remote-credential canaries.
  This probe uses one product process, so its warm execution Git cache differs
  deliberately from the original two-probe path. It cannot establish original
  full-case latency. Trace component counts; follow with separately budgeted
  cold-process baseline before any optimization or test restructuring proposal.

## Additive native diagnostic runbook (not executed here)

Only `native-diagnostics.mjs` and `trace-preload.mjs` are new instrumentation.
They do not alter checked-in product/tests or rewrite workflow line endings.
Use a dedicated non-main, synthetic-only workflow_dispatch transported by the
Coordinator, `permissions: contents: read`, `timeout-minutes: 10`, checkout with
`persist-credentials: false`, setup-node 22.23.3 (initial comparison) and npm ci.
No production environment, Actions connection Secrets, Docker, deployment,
network service requests or gate-state writes. npm ci's dependency download is
setup, not a product probe. Retain install failure as failure; no hidden retry.

After verifying the transported code differs only by additive instrumentation/
diagnostic workflow, run in PowerShell:

```powershell
node --version
node -p "JSON.stringify({node:process.version,uv:process.versions.uv,platform:process.platform})"
git rev-parse HEAD
node docs/test-reports/windows-release-diagnosis-20261008/native-diagnostics.mjs
```

The optional single-case argument is one of `workflow`, `privacy`, `parent`,
`subprocess`, `confirmation`, `binding`, `healthy`. The default runs all seven
predetermined cases once; this is not an automatic retry loop. Product payload
files remain candidate bytes. Original release full-suite/native gates remain
untouched and mandatory; green diagnostics do not close F004.

Safety/measurement contract:

- Reject non-Windows or non-Node22 before probes. Each case gets a fresh short
  `tw-*` temp root, synthetic HOME/USERPROFILE and TEMP/TMP/TMPDIR, empty Git
  config and prompt disabled. Child environment allowlists system/PATH only,
  excludes account credentials, proxy/provider env and inherited NODE_OPTIONS.
  Synthetic data mutations are inside the owned root only.
- 40-second independent watchdog per case; output limited to 64 KiB combined,
  trace limited to about 512 KiB per group (possible one-row concurrency overrun).
  Bound arguments and diagnostics emit metadata/lengths only, not raw content,
  stream bytes or taskkill stderr. Canary scan suppresses contaminated result
  bytes and marks diagnostic incomplete. Trace uses owned-path labels.
- Watchdog taskkill targets only the still-live directly spawned diagnostic
  child PID, with /T /F and 2-second timeout, followed by direct SIGKILL. Never
  target an executable name or enumerate/kill unrelated processes. Normal
  completion never taskkills recorded stale PIDs.
- Original subprocess fixture has its own 15-second lifetime cap. After its
  case, wait 16 seconds and check only its appended PIDs; report live residues,
  retain their temp root and fail diagnostic completion. PID reuse can create a
  conservative false-positive liveness result; no old PID is killed to hide it.
  A disposable hosted runner remains the outer containment boundary. Unknown
  cleanup is failure, not accepted safety.
- Preload wrappers call original APIs once and propagate original errors.
  Worker stdout protocol is untouched. Trace event sequence/monotonic time is
  per PID; correlate cross-PID wall time without pretending it is perfectly
  ordered. Trace I/O adds overhead, so instrumented timings are branch evidence,
  not uninstrumented performance acceptance.
- Outputs: a new `native-output-<timestamp>/` directory, seven result JSONs,
  seven JSONL traces and seven cleanup JSONs. Artifacts must retain runner,
  exact diagnostic/candidate SHA, runtime versions and code/source hashes.
  `diagnosticCompleted` means transport/process/logging completed, NOT product
  PASS. Inspect counts/refusals/liveness before interpretation.

## Next-step boundaries

1. Run and archive additive native diagnostics first. Resolve W04's errno/type
   branch, W02's exact failing syscall, W06's true descendant liveness and W07's
   taskkill/close race. No code repair is authorized by this report.
2. Plan narrowly scoped fixes or additive real-native fixture controls from
   those results. Keep all old bytes/assertions; any old-test adaptation requires
   explicit separate adjudication. Never weaken privacy filters, deadlines,
   no-skip floors or global testTimeout to make release green.
3. Fresh cross-family evaluator rechecks exact repaired candidate on Windows,
   then complete original exact-candidate release gates. Do not infer production
   readiness from these diagnostic scripts or the other green CI jobs.

Machine-readable details and required evidence separation: `diagnosis.json`
against `diagnosis.schema.json`. Source hashes are included there. Local checks
only: Node22 syntax, JSON/schema validation and git diff whitespace/path scope.
`local-checks.json` retains the initial missing-Ajv validation attempt; final
validation used the existing root dependency read-only. Full cached diff whitespace
check flags original CI log whitespace; only authored paths are whitespace-clean.
Do not reformat immutable logs to make this cosmetic check pass.
