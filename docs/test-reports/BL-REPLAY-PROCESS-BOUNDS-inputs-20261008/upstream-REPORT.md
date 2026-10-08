# B03 bounded historical replay — fresh independent Kimi-family evaluation

- Date: 2026-10-08
- Evaluator: Kimi Code CLI (independent family from the Codex generator/prereview line), fresh context, working directly from disk state and live probes. No Generator or same-family prereview claim was relied on; every statement below traces to a command output captured under `evidence/` or to a re-runnable script under `probes/`.
- Product under test: detached HEAD `6a030f6a3099684058cd5caed049f943cf03ab9a` (verified; worktree has **no git remote**; nothing was pushed, deployed, committed, or modified outside this report directory).
- Inspected slice: `d39c796^..HEAD` — i.e. the full replay slice starting at the baseline before `420b539` (`237094a`), through the round2 repair, plus the final diff `d20da68391b4cde73e4b29a5385c7dc3fbbeddef..HEAD` (`16ee8de` shared deadline + reject-before-write, `ade94c9` Git termination budget, `6a030f6` handoff docs). Code surface: `src/cli/{replay,replay-contract,privacy,collect,git,sync,agent,index}.ts`, `src/parsers/{claude,jsonl}.ts`, and the slice's tests/fixtures.
- Spec: `docs/specs/B03-scope-admission-slice-20261007.md` (R07 bounded replay contract).

## Verdict (slice only — NOT a release verdict)

**slice_verdict: PASS** (with two honestly documented execution-boundary limitations, F1/F2 below — neither weakens any fail-closed safety property).

**release_ready: false.** This evaluation covers only the replay slice on a detached HEAD in a remote-less worktree. There has been no main-branch integration, no production deploy, and no F005/main/production gates. Broader B03 closeout items (non-Claude adapters, raw diagnostic opt-in, identity migration, canary rollout, historical cleanup) remain explicitly out of scope per the spec.

## L1 (local, macOS arm64, Node v22.22.0 via nvm, `npm ci`)

| Check | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS (0 errors/warnings, `--max-warnings=0`) | `evidence/lint.log` |
| `npm run verify` (prisma generate + tsc) | PASS | `evidence/verify.log` |
| Focused B03 files (11 files) | PASS — 109 passed / 3 skipped (Windows-only cases skip on macOS) | `evidence/focused-b03.log` |
| Full `npm run test` (clean re-run) | PASS — 1639 passed / 26 skipped, 127 files | `evidence/full-test-rerun.log` |
| `git diff --check` on `src/ tests/ bin/ package.json` | clean | this log |

Note: the first full-suite run showed 1 failure in `tests/cli/agent-lifecycle.test.ts` (`spawnSync` 5 s timeout under probe load, pre-B04-era file, untouched by this slice). It passed in isolation and in the clean re-run above — local resource contention, not a product regression (`evidence/full-test.log` kept for audit).

## CI verification — run 37671827051 (independently fetched via `gh api`)

- workflow `Deploy VPS`, event `workflow_dispatch`, branch `codex/b03-replay-deadline-ci-20261008` (non-main), **headSha = `6a030f6a3099684058cd5caed049f943cf03ab9a` = local HEAD exactly** (`evidence/gh-run-37671827051.json`).
- Run already terminal (`status=completed`, `conclusion=success`) at inspection time; no waiting required.
- Jobs: `Verify` success (1639 passed/26 skipped — log content-verified, incl. lint/tsc/build steps), `Verify (Windows)` success (1630 passed/35 skipped; the B03 suites ran natively — `replay-safety-regression` 11 tests incl. UNC/device/alternate-stream refusals and junction races, `b03-replay-deadline` 4 tests, `replay` 6 tests), `Verify (PostgreSQL 16)` success, `Verify (authenticated browser)` success, **`Deploy` = skipped** as required on a non-main ref (`github.ref == 'refs/heads/main'` guard). Logs: `evidence/gh-verify-job-112965233092.log`, `evidence/gh-windows-job-112965233096.log`.

## Independent probe results (all probes re-runnable: `probes/`, logs in `evidence/`)

91 probe checks written by this evaluator (not reused from the Generator): **all PASS** — `probe-lib` 28/28, `probe-cli` 37/37, `probe-sync` 9/9, `probe-backfill` 9/9, `probe-queue` 8/8, `probe-deadline` 5/5 (+2 boundary notes +1 observed platform limit).

Mapped to the requested negatives:

- **Dot traversal**: refused at both layers — plan rejects non-canonical input and `readBoundedReplayFile` rejects `.`/`..` segments (`probe-lib` B1, `probe-cli` E3l). Note: paths must be canonical — on macOS, `/tmp/...` and `/var/...` are refused outright because `/tmp`/`/var` are symlink parents (fail-closed; matches the suite's canonicalization fix `86aabe9`).
- **Symlink to excluded physical project**: leaf symlink refused (`non-symlink`); event whose `cwd` is an allowed-looking alias resolving into an excluded real dir gets `wouldAdmit=0` at preview and zero admission at execute (`probe-lib` C1/C5, `probe-cli` E9a–E9d). Broken symlinks fail closed (C3). `physicalScopePath` resolves through symlink ancestors even for not-yet-existing descendants.
- **Retarget after preview**: file append, include/exclude edit, `projectRoots` change, workspace-alias retarget, and **real-Git branch drift** (no mocks — `git checkout -b` between two CLI processes) all invalidate the digest and refuse before merge, queue byte-identical (`probe-cli` E5a–E5c/E9c, `probe-backfill` N5–N6; `probe-lib` D4–D5). A zero-admission digest cannot be reused after retarget (E9c).
- **projectRoots and payload drift**: digest binds `projectRoots` and the full minimized candidate payloads (branch flip changes digest; stale digest refused, N5/N6).
- **Regular file / FIFO / parent symlink races**: stat→open swap refused; growth after read refused; **FIFO swap refused in 6 ms without blocking** (O_NOFOLLOW+O_NONBLOCK+fstat); parent dir replaced by symlink mid-read refused; parent replaced by fresh dir + hardlink preserving the leaf inode refused via parent identity (`probe-lib` B5–B9).
- **Queue and cursor preservation**: dry-run left `~/.tokenizer` byte-identical (queue/cursor/config; no state file, no stray files — `probe-cli` E2). Execute preserved the pre-existing backlog row byte-exact, admitted only the selected event, second execute idempotent (`duplicates=1, admitted=0`), cursor untouched (E4). Foreign-held queue lock → bounded refusal (5 s lock wait; product path passes the remaining ~9.8 s budget), queue byte-identical (`probe-queue` Q1). Corrupt queue fails closed without overwriting (Q4). Ack removes only the exact acknowledged event version; concurrent corrections retained (Q3); 5 racing writers from independent processes serialized without loss (Q2).
- **Only explicitly selected single file and budgets**: sibling FIFO and unreadable sibling next to the selected file never opened (E10); byte budget exact-boundary + detection byte (B5); event budget enforced (suite + E3k); >50 000 physical records and >1 MiB line refused (B10); plan rejects unknown/widening keys (`maxFiles`, `recursive`, `homeDir`, `execute`, `root`), globs, relative paths, directories, non-`.jsonl`, noncanonical UTC, range >31 days, budgets >16 MiB/>5000 (A1–A5, E3a–E3l); frozen plan pins `maxFiles: 1`.
- **Dry-run no mutation, no network**: byte-identical state (E2); dry-run succeeds in `sync` mode against an unreachable server (E7a); `replay.ts` contains no network call (grep-verified); fixture server saw zero requests across the whole local-only lifecycle (`probe-sync` S1–S2). Sample output is minimized aggregates only — no paths/IDs, capped at 5 (D7, E2).
- **local-only → sync backlog behavior**: replay admission in local-only stays local; `configure --privacy-mode sync` uploads nothing by itself; the next `sync` uploaded exactly the replayed + legacy backlog once and drained acknowledged rows (S1–S3). `status`/`configure`/`collect` output discloses backlog count and "uploads on the next Agent/run/sync cycle" timing (E8, S2). No scope fingerprint on the wire; Claude payload minimized (no `rawJson`) (S3; grep confirms fingerprints are only a local state label / status output / replay digest).
- **No implicit historical backfill**: excluded record collected under an exclude rule advanced the cursor; clearing the rule left the cursor byte-identical; re-collect admitted nothing historical; only a genuinely new append was admitted (`probe-backfill` N1–N4).
- **Bounded stalled Git child + final-admission deadline**: with a real stalled `git` shim on PATH, both dry-run and execute **refuse with `Replay refused: Git enrichment exceeded 10000ms deadline` before any durable mutation** — execute left the queue byte-identical (`probe-deadline` T1/T2; T2 exercised the execute path's own re-inspection/enrichment with a valid fresh digest). The operation-internal deadline chain works: measured in isolation, `enrichEventsWithGit` kills the stalled child at ~8.0 s (termination margin included) and the shared deadline covers both enrichments + confirmation reread + queue-lock wait + pre-mutation guard (suite's deterministic deadline tests + Q1).

## Findings / honest boundaries

- **F1 (boundary, pre-existing code outside the slice diff):** end-to-end CLI wall-clock is **not** capped at ~10 s when Git stalls. `src/cli/agent-version.ts:14-29` runs `git rev-parse --short=12 HEAD` at **module load with no timeout** (imported transitively via `sync.ts`, so every CLI command pays it, including `replay`). With the stalled shim, this call alone lingered 30 s *before* the replay operation (and its deadline) started — measured decomposition in `evidence/git-stall-startup-evidence.log` (`rev-parse --short=12 HEAD` at t≈0.4 s, bounded enrichment `rev-parse --show-toplevel` at t≈30.7 s killed ~8 s later, refusal at ~38.7 s). The file is untouched by this slice (last changed in `e4c7578`, pre-B03). Safety is unaffected (fail-closed, no mutation); the slice's own 10 s operation deadline is real but starts only inside `dryRunBoundedReplay`/`executeBoundedReplay`. **Recommendation (follow-up, not a slice blocker):** give the module-load probe a small timeout or make it lazy/async.
- **F2 (platform limit, stated honestly):** the deadline cannot preempt (i) an individual synchronous filesystem syscall (`lstat`/`open`/`read`/`realpath`) that never returns — checks run between stages; nor (ii) a child process that ignores/defers SIGTERM — Node 22's synchronous-spawn timeout sends SIGTERM and then **waits for the child to exit** (`evidence/node-syncspawn-timeout-semantics.log`: SIGTERM-ignoring stub returned only at its natural 5 s exit; in CLI probe T3 the process was still blocked at the 23 s outer guard and had to be SIGKILLed externally). Ordinary stalled children die at the timeout (~8 s path measured). These are unavoidable with the current synchronous architecture; the report does not claim a universal 10 s end-to-end wall-clock cap.
- **F3 (probe-hygiene note, no product defect):** `executeBoundedReplay`'s default merge target is the real `~/.tokenizer/queue.jsonl`; tests must inject `mergeEvents` (as the suite does). One early iteration of my `probe-queue` omitted the injection and appended one synthetic row to this machine's real queue; it was verified to be the file's only line and was deleted immediately. No other real-home state was touched.

## What was NOT verified (out of scope / absent gates)

- No main branch, no production deployment, no staging canary — `release_ready=false`.
- F005 (browser freshness) and other batches' gates are untouched.
- Windows behavior was verified via the GitHub Windows runner on the exact SHA, not on a local Windows machine; the PowerShell reparse-point check path is exercised there.
- Theoretical hardening not probe-tested: mtime/ctime-forging attacks that keep all six identity fields stable (content SHA-256 still binds content), and multi-day stall scenarios.

## Evidence inventory

`evidence/`: `lint.log`, `verify.log`, `focused-b03.log`, `full-test.log` (first run, contains the load flake), `full-test-rerun.log` (clean), `probe-lib.log`, `probe-cli.log`, `probe-sync.log`, `probe-backfill.log`, `probe-deadline.log`, `probe-queue.log`, `git-stall-startup-evidence.log`, `node-syncspawn-timeout-semantics.log`, `gh-run-37671827051.json`, `gh-verify-job-112965233092.log`, `gh-windows-job-112965233096.log`. Integrity: `SHA256SUMS`.

`probes/` (independently executable, no vitest dependency beyond tsx from the repo): `probe-lib.ts`, `probe-cli.sh`, `probe-sync.sh` + `fixture-server.mjs`, `probe-backfill.sh`, `probe-deadline.sh`, `probe-queue.ts`. Run any of them from the repo root with Node 22, e.g. `node --import tsx docs/test-reports/B03-replay-kimi-evaluator-20261008/probes/probe-lib.ts` or `bash docs/test-reports/B03-replay-kimi-evaluator-20261008/probes/probe-cli.sh`; all exit 0 on pass.
