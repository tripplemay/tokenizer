# BL-REPLAY-PROCESS-BOUNDS — F005 independent Kimi-family evaluation (2026-10-08)

Evaluator: fresh Kimi-family instance `replay-process-bounds-3130cef-kimi-r0`. Never Generator.
Candidate verified: `git rev-parse HEAD` = `3130cef3bc55528290c49ee35267e1aff33b5c78` = `repo.ref`.
Spec read from disk: `docs/specs/BL-REPLAY-PROCESS-BOUNDS-spec.md` (incl. F003 cwd adjudication and scope/OS limits).
All Generator/historical reports treated as claims, not acceptance. No real-home probe replayed; no personal
queue/source/config touched; nothing pushed, deployed, committed, or written to any gate decision.

## Environment and sandbox

- Node `v22.22.0` from `/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`, npm 10.9.4, git 2.54.0 (Apple Git-157), macOS arm64.
- Fresh `npm ci` in this dedicated evaluator worktree (670 packages, exit 0); no shared node_modules.
- Every probe ran with `env -i` and short canonical synthetic roots under `/private/tmp/tk-ev-*`
  (HOME=USERPROFILE, TMPDIR, explicit queue paths) set BEFORE any product import; probes assert this.
- External watchdog `probes/ev-watchdog.mjs` wrapped every probe: detached process group, group SIGKILL on
  timeout, backstop kill limited to pid-file-recorded owned fixture processes only. Post-run sweep: no stray
  fixture/shim/worker processes.

## Independently derived adversarial controls (my own fixtures, not Generator's)

Probe sources: `probes/ev-child.mjs`, `ev-git-shim.mjs`, `ev-worker-killer.mjs`, `ev-watchdog.mjs`,
`ev-version-probe.mjs`, `ev-replay-probe.mjs`, `probe-f001.mjs`, `probe-f002.mjs`, `probe-f003.mjs`.
Run pattern per probe: `env -i PATH=… HOME=… node probes/ev-watchdog.mjs <budget> <pidfile> -- node --import tsx probes/probe-f00X.mjs`.

### F001 — bounded subprocess primitive: PASS (11/11 controls, `f001-probe.log`)

- argv/cwd/env/stdout/stderr preserved without shell; `"one;two"`/`"three four"` survive unsplit.
- Nonzero exit (17) distinguished from launch failure; missing executable → `BoundedSubprocessLaunchError`;
  missing TARGET cwd → `BoundedSubprocessLaunchError` code `ENOENT` (target ENOENT ≠ supervisor failure).
- Invalid timeouts/output budgets (0, −1, NaN, Infinity, 0.5, 2³²) → `RangeError` with zero new spawns.
- SIGTERM-resistant child: `BoundedSubprocessTimeoutError` at 538 ms (budget 500 ms + 2 000 ms allowance), group reaped, 0 live.
- SIGTERM-resistant descendant holding inherited pipes after parent exit: timeout at 559 ms, no close-hang, both owned processes reaped.
- Output overflow: `BoundedSubprocessOutputError`, `EV-RAW-STDERR-CANARY-KIMI` absent from the error, child reaped.
- Combined stdout+stderr charged against one budget (1 024 refuses, 1 400 passes with exactly 1 400 bytes).
- Worker killed 300 ms AFTER publishing the owned child PID (`NODE_OPTIONS` preload `ev-worker-killer.mjs`):
  `BoundedSubprocessSupervisionError` with no `EV-RAW-WORKER-CANARY-KIMI` leak, and the parent SIGKILLed the
  published group (0 live). This mid-flight supervision-failure path is coverage BEYOND Generator's controls
  (their worker died before spawn).
- Signal preservation: self-SIGTERM child → `{status: null, signal: "SIGTERM"}`.
- Retained probe-bug log: `f001-probe-v1-probe-bug.log` (v1 assertion bugs — pid accumulation/absolute counts
  and a misrouted missing-executable call; product behavior was already correct; corrected v2 passed 11/11).

### F002 — bounded startup version snapshot: PASS (7/7 controls, `f002-probe.log`)

Fake install tree with real product bytes; my own git shim first on PATH; fresh process per mode.
- `stall` (SIGTERM-resistant) → null in 2 198 ms — within the 2 000 ms budget + declared 2 000 ms POSIX allowance (ceiling 4 500 ms).
- `overflow` (256 KiB vs 128-byte cap), `invalid`, `short`, `nonzero`, `signal` → null, each ≤ 149 ms.
- Healthy: exact 12-hex checkout SHA (`e76833db9dcf`); after advancing the on-disk checkout post-import,
  module still reports the import-time SHA while disk shows `4f7bfcddaa8c` — startup snapshot frozen.

### F003 — replay subprocess deadline integration: PASS (6/6 controls, `f003-probe.log`)

Explicit synthetic queue/cursor/config with known bytes; byte comparison around every refusal.
Each replay invocation ran in a FRESH child process (mirrors CLI usage; avoids git.ts per-process workspace
cache — see retained v1 note below).
- Stalled SIGTERM-resistant git tree + pipe-holding descendant refuses PREVIEW: `Replay refused: Git
  enrichment exceeded 10000ms deadline` at 8 039 ms; queue/cursor/config byte-identical; 2 tracked owned
  processes, 0 live after refusal; no raw canary in the error.
- Same tree refuses EXECUTE with a VALID confirmation digest (from a healthy preview of the same file):
  refusal at 8 037 ms; all state byte-identical; 0 live owned.
- Shared operation deadline: 2.5 s/call shim over a real repo → refusal at 8 043 ms after 4 sequential git
  invocations — the 10 s deadline is never renewed per call.
- Overflowing git → `Replay refused: Git enrichment could not complete safely`, no `EV-RAW-GIT-CANARY-KIMI`.
- Healthy end-to-end: preview read-only; confirmed execute admitted exactly 1 minimized event with 40-hex
  `gitCommit`, credential-bearing remote normalized to `https://git.example/team/ev-fixture.git`; queue
  contains no message canary / private token / username; cursor/config untouched.
- Queue-lock late-failure guard: verified structurally (`src/cli/queue.ts:66` invokes `beforeMutate` inside
  `withFileLock` before the atomic write; `src/cli/replay.ts:388-394` passes the remaining-deadline guard) and
  dynamically via the retained `QUEUE_LOCK_GUARD` case in my own focused run below.
- Retained `f003-probe-v1-cache-poisoned.log`: probe v1 ran the healthy digest preview and the stalled preview
  on the SAME workspace in one process; the legitimate per-process GitInfo cache (documented at
  `src/cli/git.ts:15`) served the stalled runs from cache, so refusal paths never fired and v1 correctly
  flagged its own assertions (queue mutation caught by byte comparison). Not a product defect — v2 isolates
  each invocation in a fresh process and all refusal controls pass. This cache behavior is worth Coordinator
  awareness only as test-authoring guidance (CLI usage is one invocation per process).

### F004 — regression/portable fixtures + frozen inputs: PASS

- Frozen-input inventory rerun independently: `input-inventory.json` — 1 277 pre-existing tracked
  tests/reports under `tests/` and `docs/test-reports/` byte-identical to `ba292a0`; 0 altered; 18 new
  source/test/fixture paths inventoried; HEAD = candidate SHA.
- Product diff vs baseline confined to the 5 allowed files (`agent-version.ts`, `bounded-subprocess.ts`,
  `bounded-subprocess-worker.mjs`, `git.ts`, `replay.ts`); F004 commit `3130cef` touches no product files.
- Independent baseline F1 reproduction on exact `ba292a0` bytes (`f004-baseline-startup-repro.log`): real
  baseline `agent-version.ts` (no timeout, no output cap — confirmed by inspection) under my stalled
  SIGTERM-resistant git shim hung module load past the 5 000 ms external watchdog and required watchdog
  SIGKILL; owned shim group cleaned, no strays. This matches B03-F1 and the Generator's heavyweight repro.
- Baseline F2 (SIGTERM-resistant replay child): confirmed by inspection — `ba292a0:src/cli/git.ts` uses
  `execFileSync` with a SIGTERM-based sync timeout and no process-group/tree kill; my shim's SIGTERM
  resistance is empirically proven above (only SIGKILL reaped it). Generator's full end-to-end baseline
  replay repro (`baseline-reproduction.log`, watchdog kill at 11 510 ms, 7 owned processes cleaned) was NOT
  rerun by me (time-boxed); treated as corroborating, not acceptance.
- Windows-only tests remain explicit macOS skips (6 skipped in focused/full runs), not inferred PASS.

## Independently rerun standard gates

| Gate | Command | Result | Log |
| --- | --- | --- | --- |
| npm ci (fresh) | `npm ci --no-audit --no-fund` | exit 0, 670 pkgs | (npm output; Generator log records 7 high audit findings, not re-derived — `--no-audit` used) |
| lint | `npm run lint` | exit 0 | session log |
| verify | `npm run verify` (prisma generate + tsc --noEmit) | exit 0 | session log |
| build | `npm run build` | exit 0 (BUILD_EXIT=0, compiled successfully) | `build.log` |
| focused | vitest over process-bounds + replay/privacy/queue/B03/B07/collect/git suites (23 files) | 189 passed / 6 skipped, exit 0 | `focused.log` |
| full, DEFAULT concurrency | `npx vitest run` | 1 919 passed / 34 skipped (162 files passed / 13 skipped), exit 0 | `full-default.log` |
| full, CONTROLLED | `npx vitest run --maxWorkers=1 --no-file-parallelism` | 1 919 passed / 34 skipped, exit 0 — run separately, after the default run | `full-controlled.log` |

Counts match Generator's claims (focused 188 + my added `git.test.ts` = 189; full 1 919/34 both modes).
No pre-existing failure observed, so no failure-hiding question arises. Skips are the retained
Windows-only/platform-conditional tests; exact skip list visible in the logs.

## Scope and OS limitations (truthful bounds)

- Local macOS acceptance only: native Windows/Linux execution, exact-SHA CI, real PG16, browser/original
  homepage F005, production/release gates and the full B03/B07 programme remain unexecuted and are NOT inferred.
- Timing claims are scheduling allowances, not hard real-time guarantees: blocked synchronous filesystem
  syscalls, OS suspension of the worker, deliberately escaped process groups and an unresponsive OS are
  outside the enforced bound (product code declares the same at `src/cli/bounded-subprocess.ts:11-15`).
- npm audit findings (Generator-recorded: 7 high) not re-derived; no dependency changes in this batch.
- Generator's heavyweight baseline replay repro not rerun (time-boxed); see F004 note above.

## Verdicts

F001 PASS, F002 PASS, F003 PASS, F004 PASS, F005 PASS (this independent acceptance). Schema-valid machine
verdict: `../BL-REPLAY-PROCESS-BOUNDS-verdict.json`. Scoped signoff (release_ready=false):
`../BL-REPLAY-PROCESS-BOUNDS-signoff-2026-10-08.md`.
