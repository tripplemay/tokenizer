# B04 macOS launchd trap-path successor — independent Kimi Evaluator report

Date: 2026-10-08 · Role: Evaluator (Kimi family, fresh independent instance) · Scope: **only** diff `d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f..HEAD` (single commit `5980a6e131b1b4c234100feb820c05b4617081af`, "ci(B04): bind macOS launchd fixture and trap temp root").

This is a successor evaluation. The earlier d1d-based Kimi verdict (`B04-macos-kimi-evaluator-20261008`, evaluator HEAD `133fe59e…`, candidate `d1d4bb1…`) is preserved untouched as historical; nothing here amends it. No product code, tests, state files, gates, or prior reports were modified. Nothing was committed or pushed.

## Environment attestation

- Worktree HEAD verified detached at exactly `5980a6e131b1b4c234100feb820c05b4617081af`; `git remote -v` empty (no remote configured).
- Local host: macOS 26.6.2 arm64 (Darwin 25.6.0), Node `v22.22.0` (matches workflow `node-version: 22`), fresh `npm ci` (671 packages).

## What the diff does (verified against objects, not generator narrative)

Four lines are added to the `verify-macos-agent` native step of `.github/workflows/deploy-vps.yml:227-230`, immediately after `set -euo pipefail`: require `RUNNER_TEMP`, canonicalize it with `pwd -P`, set `TMPDIR` to that canonical path, export both. Base SHA `d1d4bb1`'s step is byte-identical except for these four lines (verified via `git show d1d4bb1:…deploy-vps.yml`), so the change is exactly the binding.

Chain of custody for the canonical root, all three consumers verified:

1. **Fixture creation** — `tests/cli/agent-release-installer-macos.test.ts:160` builds the root via `mkdtempSync(join(tmpdir(), "tokenizer-macos-launchd-"))`; Node's `os.tmpdir()` returns `TMPDIR` verbatim, which the workflow now pins to canonical `RUNNER_TEMP`.
2. **Service HOME guard** — `src/cli/service.ts:37-41` (`resolveLaunchdIdentity`) requires the isolated HOME to equal or sit under `resolve(tmpdir())`; fixture HOME is `$root/home`, so the guard passes precisely because of the same binding. (Generator's claim that rebinding only the fixture root would have broken this guard checks out.)
3. **Emergency trap** — the pre-existing `trap cleanup_native_fixture EXIT INT TERM` allowlist compares `TOKENIZER_FIXTURE_ROOT` against `"$RUNNER_TEMP"/tokenizer-macos-launchd-*`, i.e. the same canonical string the fixture now writes into `.ci/macos-launchd-cleanup.env`.

## Question-by-question findings

**Does cleanup actually run on abnormal termination?** Yes, proven by executing the *actual extracted workflow step* (not a copy) under an intentionally different initial `TMPDIR`/`RUNNER_TEMP` with a fake `npx` that writes the real record and `exit 42` before any `afterEach`: the EXIT trap fired, `launchctl unload` was called, root and record were removed (`tests/ci/macos-launchd-cleanup-trap.test.ts` test 1 — passing locally and in the CI Verify job). The fake-npx assertions (exit 65/66) also directly pin `TMPDIR == RUNNER_TEMP` and `os.tmpdir() == RUNNER_TEMP` inside the step. Honest boundary: on the real CI runner and on this host the fixture passes normally, so its `afterEach` deletes the record first and the trap is an unfired backstop; the trap's real-fire path is proven synthetically against genuine step text with faked `npx`/`launchctl`/`ps`/`xargs`, not by a deliberately failing native run. The INT/TERM signal path shares the same handler (standard bash semantics) and is not separately exercised.

**Are out-of-scope records rejected?** Yes. The trap refuses unless label matches `cc.tokenizer.agent.ci.*`, root matches `"$RUNNER_TEMP"/tokenizer-macos-launchd-*`, and plist sits under root; on refusal it deletes nothing and never calls `launchctl`. Test 2 asserts root + record retained and zero launchctl calls. Glob quoting in `[[ … ]]` is the correct idiom (quoted literal prefix, unquoted `*`), so glob metacharacters in the path would be treated literally — fail-closed.

**Do tests prove old negative fails and new positive passes on macOS?** Yes. Test 3 (negative control) strips exactly the four-line binding from the real step (and throws if the binding is absent) and reproduces the base-SHA defect: fixture root lands under the divergent Node `TMPDIR`, the trap refuses it as out-of-scope, the fixture is orphaned. Test 1 is the positive. Both ran green on this macOS 26.6.2 host (12/12 with the gate test) and inside CI at the exact SHA (`Verify` job log: both files ✓, 3 + 9 tests). Because base and HEAD steps differ only by the four lines, the negative control faithfully replays the old behavior.

**Shell quoting / path / symlink audit.** The `pwd -P` canonicalization is load-bearing on macOS (`/var` → `/private/var`); the test asserts against `realpathSync(runnerTemp)`, so symlinked temp parents are genuinely exercised — my own host run canonicalized `/tmp` to `/private/tmp`. `source` of the env record, `awk -v root=…`, `xargs kill … || true`, and `set -u` inside the trap body are all pre-existing from the base SHA; malformed records fail closed (unset var under `set -u` aborts the handler before any deletion; misparsed source never reaches the allowlist match). No new quoting/symlink defect introduced by the four lines.

## GitHub run 37670505412 (independently inspected via `gh`)

Waited to terminal state. `status=completed`, `conclusion=success`, `event=workflow_dispatch`, branch `codex/b04-macos-trap-path-ci-20261008` (safe, non-main), **`headSha` = `5980a6e131b1b4c234100feb820c05b4617081af` — exactly the evaluated HEAD**.

| Job | Conclusion |
| --- | --- |
| Verify | success (full unit suite at exact SHA: 1712 passed / 24 skipped; contract 6/6; both new test files ✓) |
| Verify (Windows) | success |
| Verify (macOS launchd) | success (native step incl. binding; 8/8 steps) |
| Verify (authenticated browser) | success |
| Verify (PostgreSQL 16) | success |
| Linux OCI and recovery rehearsal (release-artifact; needs all five verify jobs) | success |
| **Deploy** | **skipped — 0 steps**; `if:` requires `refs/heads/main`, structurally excluded on this branch |

Native macOS artifact `macos-launchd-pinned-installer` (id 11505196524) independently downloaded; its zip SHA-256 (`feee97d0…4f75e8`) equals the digest printed in the job log. Contents: `success:true`, 1 passed / 0 failed, exact fixture fullName passed once. The repo's own gate `scripts/ci/assert-macos-launchd-installer.mjs` re-validated locally against the downloaded JSON: exit 0. In the job log the binding lines execute; the sole "Refusing…" hit is the runner's script echo, not a refusal event. CI fixture observations: 4 distinct commits / 4 agent PIDs, credential + queue canaries retained, `scopedProcessesAfterUnload: 0` (`defaultLabelPresentBeforeAndAfter:false` is expected on an ephemeral runner).

## Local independent re-execution (this host, Node v22.22.0)

| Check | Result |
| --- | --- |
| `npm ci` | pass, 671 packages |
| `npx vitest run tests/ci/macos-launchd-cleanup-trap.test.ts tests/ci/macos-launchd-installer-gate.test.ts` | 12/12 passed |
| Native fixture with workflow-equivalent `RUNNER_TEMP`/`TMPDIR` binding (`tests/cli/agent-release-installer-macos.test.ts`) | 1/1 passed (25.7s); canaries retained; host default label `cc.tokenizer.agent` present before **and** after; 0 leftover fixture roots, 0 scoped processes, 0 `cc.tokenizer.agent.ci.*` labels |
| `npm run lint` / `npm run verify` | exit 0 / exit 0 |
| `actionlint .github/workflows/deploy-vps.yml` | pass |
| `git diff --check d1d4bb1..HEAD` | pass |

Full 142-file suite was **not** re-run locally; the CI `Verify` job at the exact SHA covers it (1712 passed / 24 skipped) — stated plainly rather than claimed as local evidence.

## CI fixture acceptance ≠ signed Agent release

This slice proves the CI-native abnormal-cleanup path on a safe branch. It is **not** a signed Agent release: no packaging/signing/notarization, no manifest or tag publication, Deploy structurally skipped (non-main `workflow_dispatch`), destructive fault matrix (SIGKILL/power loss mid-cutover, disk full, corrupt plist, failed `launchctl load`, sleep/wake) untested, real Windows Task Scheduler untested, headless-runner strategy and `macos-latest` pinning still open. `release_ready` is therefore **false**.

## Verdict

Slice verdict: **PASS** — all seven evaluation questions answered affirmatively with independently gathered evidence (gh API, downloaded artifact + digest match, gate revalidation, local re-execution on macOS). `release_ready: false`. Evidence files: `evidence/` (run metadata JSON, native job log, downloaded installer JSON).
