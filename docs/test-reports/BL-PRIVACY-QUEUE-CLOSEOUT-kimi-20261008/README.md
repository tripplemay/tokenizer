# BL-PRIVACY-QUEUE-CLOSEOUT — F002 independent acceptance (Kimi evaluator, round 0)

Evaluator: fresh Kimi-family CLI instance (different model family than the Codex generator).
Candidate: `27d9664e37a659ad28962bee224d871378e4336c` — verified with `git rev-parse HEAD` in the
assigned worktree and checked out identically (`git checkout 27d9664…`, 0 dirty files) in the
evaluator's own sandbox clone `/tmp/pqev27d9/repo` (local `git clone --no-hardlinks` of the frozen
worktree). All commands ran in the sandbox with fresh `npm ci` (no shared `node_modules`);
synthetic `HOME`/`USERPROFILE`/`TMPDIR` under short `/tmp` roots. No product/config/state file was
written by the evaluator; the only new files are the three test artifacts copied into this report
directory. No push, deploy, human-gate write, or personal source/queue/config access.

Node: v22.22.0 (`/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`), npm 10.9.4, macOS 26.6.2 arm64 (Apple M4).

## Command results (all independently re-run, raw logs in this directory)

| Command | Result | Log |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | exit 0, 670 packages in 1m (audit deliberately not re-run; generator recorded 7 high findings with no dependency change) | npm-ci.log |
| `npm run lint` | exit 0 (8.6s) | lint.log |
| `npm run verify` (prisma generate + tsc) | exit 0 (9.4s) | verify.log |
| `npm run build` (synthetic unreachable DB placeholder `postgresql://127.0.0.1:1/...`) | exit 0 | build.log |
| Focused suites (generator's F001 set, `--maxWorkers=2`) | 29 files, **168 passed / 3 skipped**, exit 0 — matches generator claim | focused.log |
| Full `npx vitest run` (**default workers**, short synthetic TMPDIR) | 159 files, **1883 passed / 31 skipped, 0 failed**, exit 0 (21.9s) | full-default.log |
| Full `npx vitest run --maxWorkers=2` (controlled) | identical totals, exit 0 (43.3s) | full-controlled.log |
| Evaluator adversarial unit tests (`kimi-f002-adversarial.test.ts`) | **16/16 passed** | kimi-tests.json/log |
| Evaluator real multiprocess + loopback HTTP probe (`kimi-f002-multiprocess.*`) | **1/1 passed** (4 scenarios) | kimi-tests.json/log |

31 skips match the generator's `skips.json` total exactly (scratch-DB probes with no `EVAL_*_DB_URL`,
native-Windows cases on darwin, external contract fixtures) — environment gates, not passes.

## Default vs controlled concurrency (reported separately, per contract)

- Controlled (`--maxWorkers=2`): exit 0, 1883/31 — reproduces the generator's short-root result.
- **Default workers: exit 0, 1883 passed / 31 skipped on this machine with a short synthetic
  TMPDIR.** The generator's long-root default-worker run recorded 2 failures (B06 tsx socket
  collision at 111-byte IPC paths + `harness-command` 5000ms CLI subprocess timeout). Under a
  short root both symptoms disappeared here, consistent with the generator's environmental
  causality note (socket path length) — but this is one machine/one run, not proof of default/CI
  stability. The `harness-command` timeout's baseline reproducibility remains unestablished.

## Spec regression controls — independently derived checks

Mapped to spec "Required regression controls" (generator evidence treated as claims, not proof):

1. **Backlog + multiple versions retained** — `kimi-f002-adversarial.test.ts` "control 1+4": pre-seeded
   backlog + correction, then merge of an older historical version ⇒ 4 exact versions coexist,
   identity first-seen position preserved; identical re-merge adds 0. Also exercised on the **real
   replay path**: `executeBoundedReplay` into the shared queue retained a pre-existing unrelated
   backlog row and a newer correction of the replayed ID (admitted=1, queue=3; re-execution
   admitted=0).
2. **ACK removes only the exact version** — accepted v1 of `same-id` removed only v1; v2 and an
   unrelated row survive; stale re-ACK (`acknowledgeQueuedEvents`) is a byte-identical no-op.
   Real-HTTP variant in the probe: ACK of v1 while a child process concurrently writes v2 ⇒ v2
   survives in queue.
3. **Guard-before-mutate + lock timeout** — `beforeMutate` throwing leaves queue bytes unchanged and
   releases the lock; a foreign-held lock with `timeoutMs:400` throws `Timed out after 400ms`
   (elapsed 350ms–4s, not the 5s default) and the queue accepts writes after the holder exits.
   Replay production path supplies exactly this (`timeoutMs: remainingMs`, `beforeMutate` deadline
   assert) — confirmed by reading `src/cli/replay.ts:386-393`.
4. **Shared primitive** — `queue.ts` is the sole writer: `collect.ts` re-exports; `sync.ts`,
   `agent.ts:66,83`, `index.ts:130,145`, `replay.ts:390` all route through it; `agent.ts`,
   `index.ts`, `replay.ts` are untouched vs baseline `f8449e8` (diff stat shows only the 9 allowed
   files). Replay reuses the same lock/normalization/version identity as collection/ACK/quarantine.
5. **Versioned quarantine** — rejected v1 and v2 of one ID are two durable rows; the prior same-ID
   row does not suppress a new rejected correction (probe asserts quarantine=[2,3] over real HTTP);
   replayed rejections stay at 2 rows (idempotent).
6. **Replay physical admission negatives (freshly derived)** — symlink leaf, symlink parent,
   literal `/../` dot-segment, FIFO, relative path, glob/non-`.jsonl` plan, forged/stale
   confirmation digest, privacy-scope change after preview: all refuse; queue untouched in each
   negative. Git timeout/deadline behavior is covered by the existing b03 suites (rerun in focused,
   168 passed) — I did not re-derive a new Git-timeout injection (time-boxed).
7. **Immutable evidence** — `tests/cli/agent-sync-checkpoint.test.ts`,
   `tests/evaluator/bl-homepage-freshness-f002-f003.test.ts`, `tests/cli/queue-merge.test.ts` and the
   three archived B06 tests are byte-identical to their `f8449e8` Git objects (`git hash-object`
   match). `f8449e8..HEAD` under `docs/test-reports/` is **75 additions, 0 modifications/deletions**.
   The batch's `tests/ci/b07-combination-frozen-inputs.test.ts` (1,025 frozen files vs recorded Git
   objects) passed inside my focused run. `.gitattributes` adds `-text` pins without recalculating
   B06 expected hashes. Pre-existing anomaly (not this batch): `B02-braces-backport-generator` and
   `M1-B05-R13-round3-evaluator-evidence` SHA256SUMS list files unreadable already at baseline
   (38 tree entries at both `f8449e8` and HEAD) — recorded here, not caused by F001.
8. **Real multiprocess/HTTP, quarantine failure, crash/retry** — probe: 6 concurrent writers ⇒ 25
   unique versions, no torn JSONL, queue mode `600`; quarantine path forced to a directory ⇒
   `syncEvents` rejects and the active queue is **byte-identical** afterwards, then a healthy retry
   drains it with the poison row quarantined (quarantine-first ordering holds); SIGKILLed child
   mid-sync loses nothing, retry duplicates server-side (2 requests observed) and resolves.

Configuration adjudication (spec §"Approved configuration compatibility"): `vitest.config.ts` uses a
real `historicalTestConfig.exclude` spread into the effective exclusion array (no unused strings);
both B05 tests remain active — the focused/full runs above include them.
`tests/ci/b07-combination-test-scope.test.ts` passed in the focused set. Workflow diff is limited to
the B07 PG16 probe (`EVAL_B07_DB_URL`, probe file, floor 14→15) — no release gates removed.

## Environmental findings (preserved with causality)

- **SWC cache-root vs `/tmp` symlink**: with `HOME=/tmp/pqev27d9/home`, `next build` failed
  (`ERR_SWC_NATIVE_CACHE` — "cache root contains a non-directory or symlink"); `@swc/core-darwin-arm64`
  was correctly installed. Re-running with the realpath `HOME=/private/tmp/...` ⇒ build exit 0.
  Pure environment, product untouched. Failed log retained: `build-symlink-home-failure.log`.
- **Probe harness zombie connection**: a SIGKILLed client's never-answered request kept
  `server.close()` pending ≥40s on this machine; fixed in the probe with `closeAllConnections()`.
  Test-harness detail only; product code untouched.

## Limitations and unexecuted gates (release readiness = false)

- macOS arm64 only. **No native Windows/Linux exact-SHA CI, no real PG16, no authenticated browser,
  no service installer execution, no production/staging access, no F005 acceptance.** POSIX file-mode
  results do not prove Windows ACL behavior; the Windows reparse-point check is not exercisable here.
- Default-worker full-suite success is a single-machine observation under a short synthetic root;
  it does not establish default/CI stability or the `harness-command` timeout's cause.
- `npm ci` ran with `--no-audit`; the 7 high-severity audit findings were not re-derived by me.
- I did not re-derive a fresh Git-enrichment timeout injection (existing b03 deadline suites rerun
  and passed); server-side B08 CAS and corruption recovery are outside this slice.
- My three new test files exist only in the evaluator sandbox + this report directory; the frozen
  worktree's `tests/` tree was not modified.

## Verdicts

- **F001: PASS** — all eight spec regression controls independently reproduced at `27d9664`; lint,
  typecheck, production build, focused and full suites green in a clean sandbox; immutable-evidence
  invariants hold; limitations above are environment gates, not product defects.
- **F002: PASS** — this fresh cross-family acceptance was executed against the exact SHA with
  independently derived adversarial and real multiprocess controls; verdict and limitations recorded.
