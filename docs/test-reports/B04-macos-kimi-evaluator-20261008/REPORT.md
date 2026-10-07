# B04 native macOS launchd installer CI slice — independent Evaluator report

- Evaluator: fresh independent Kimi-family instance (no shared context with the Generator)
- Date: 2026-10-08
- Candidate HEAD (verified locally): `d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f` (`git rev-parse HEAD`, detached, no remote configured, `git status` clean before this report)
- Evaluated range: `8877a592d21305f03cdaea5d874d58a581e910a1..d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f` (5 commits)
- This is an evaluator verdict artifact. The Generator handoffs under `docs/test-reports/B04-macos-launchd-generator-20261008/` and `...-round2-20261008/` were read for context only and were **not** treated as proof; every verdict below rests on evidence re-gathered by this evaluator.

## 1. Scope of the diff (verified via `git diff 8877a59..HEAD`)

| Commit | What it does |
|---|---|
| `cea6f5e` | `src/cli/service.ts` launchd identity isolation (`resolveLaunchdIdentity`), best-effort pre-load `launchctl unload`, native fixture `tests/cli/agent-release-installer-macos.test.ts`, fail-closed gate `scripts/ci/assert-macos-launchd-installer.mjs` + `tests/ci/macos-launchd-installer-gate.test.ts`, `verify-macos-agent` job + `needs` edges in `deploy-vps.yml`, `tests/server/release-rehearsal.test.ts` expectation update |
| `9e18e41` | CI `EXIT INT TERM` trap with namespace-scoped cleanup record; fixture writes `.ci/macos-launchd-cleanup.env`; gate test pins the trap |
| `c178b45` | Generator round-1 handoff docs (no code) |
| `18ee269` | Test-only Windows portability fix in `tests/cli/service-launchd.test.ts` (`tmpdir()`+`join()` instead of hard-coded `/Users/example`) |
| `d1d4bb1` | Generator round-2 handoff docs (no code) |

Product code touched: exactly one file, `src/cli/service.ts`. Verified unchanged since `8877a59` (empty `git diff --stat`): `public/` (installer + manifest surface), `package.json`, `prisma/`, `src/shared/agent-feature-version.ts`. Release manifest, version, and tag are therefore untouched by this slice.

## 2. Source assessment

**launchd test identity isolation — sound.** `resolveLaunchdIdentity` (`src/cli/service.ts:19-43`) keeps the production label `cc.tokenizer.agent` unless **all** of: `TOKENIZER_LAUNCHD_TEST_MODE=1`, label matches `^cc\.tokenizer\.agent\.ci\.[A-Za-z0-9.-]{1,96}$`, and resolved `HOME` is inside `tmpdir()`. Any violation throws (fail-closed). Label is XML-escaped into the plist. The best-effort `launchctl unload` before `load` (`service.ts:146`) fixes fresh-install on a clean machine while the real `load` stays fail-closed. `uninstallService`/`serviceStatus` resolve the same identity, so a fixture cannot touch the default label through those paths either.

**Native fixture — real, not mocked.** `tests/cli/agent-release-installer-macos.test.ts` executes the real `public/install.sh` against a loopback manifest server and a local git remote, in a unique tmpdir `HOME` with a unique `cc.tokenizer.agent.ci.<pid>.<ms>` label, and asserts: fresh install pinned at commit 1 with live Agent PID and `launchctl print` showing the fixture plist; upgrade to commit 2 replacing the PID; staged `configure` exit-42 cutover failure → "Upgrade failed; restoring the previous Agent" with HEAD back at commit 2 and a new live PID; `--rollback` with the manifest endpoint returning 503 (unavailable manifest) → HEAD back at commit 1; byte-exact `credentials.json` and `queue.jsonl` canaries after every phase; default label presence identical before/after; final unload with zero scoped processes.

**CI gate — fail-closed.** `assert-macos-launchd-installer.mjs` requires Darwin, `success===true`, `numFailedTests===0`, `numPassedTests===1`, and exactly one assertion with the exact full name in status `passed` — a skip, rename, duplicate, or disappearance all fail. The gate's own unit tests (`tests/ci/macos-launchd-installer-gate.test.ts`) cover those rejections and pin the workflow edges.

**Workflow — correct wiring.** `verify-macos-agent` runs on `macos-latest` (20 min timeout, no `if`, so it cannot be skipped by event filtering), requires a usable `gui/$UID` domain as a hard step, runs the fixture + gate, and uploads the JSON with `if-no-files-found: error`. Both `release-artifact` and `deploy` gained `verify-macos-agent` in `needs`. The cleanup trap validates the record against `cc.tokenizer.agent.ci.*` + `$RUNNER_TEMP/tokenizer-macos-launchd-*` before touching anything (refuses otherwise), and the trap text is pinned by the gate test. `actionlint` passes.

## 3. CI verification (independent, via `gh` API)

**Run `37666960517`** (safe branch `codex/b04-macos-launchd-round2-ci-20261008`, `workflow_dispatch`):
- `headSha` = `d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f` — **exact match** with the local HEAD under evaluation.
- Terminal state observed after waiting: `status=completed`, `conclusion=success`. Jobs: Verify `112949917506` success; Verify (Windows) `112949917564` success; **Verify (macOS launchd) `112949917812` success**; Verify (PostgreSQL 16) `112949917841` success; Verify (authenticated browser) `112949917353` success; Linux OCI and recovery rehearsal `112951048908` success; Deploy `112953584675` **skipped** — correct, the branch is not `main`.
- macOS job log: checkout fetched exactly `d1d4bb10...`; `launchctl print "gui/501"` precondition ran; fixture observation line shows 4 distinct commits, 4 distinct Agent PIDs (2450/2907/3471/3779), `credentialCanaryRetained:true`, `queueCanaryRetained:true`, `defaultLabelPresentBeforeAndAfter:false`, `scopedProcessesAfterUnload:0`; the gate printed its success line.
- Windows job log: `tests/cli/service-launchd.test.ts` 6/6 **passed** and gate test 9/9 passed on real Windows — the portability fix is verified on the platform that failed before (suite: 1671 passed, 62 skipped).
- Artifact **`macos-launchd-pinned-installer` id `11502379434`** downloaded independently; JSON: `success:true`, `numPassedTests:1`, `numFailedTests:0`, exactly the one named fixture `passed` (38.1 s). Re-running the gate locally against this file exits 0.

**Run `37665390447`** (branch `codex/b04-macos-launchd-ci-20261008`, tested SHA `c178b45`): `completed`/`failure`. Verify (macOS launchd) `112943179666` **success**; Verify (Windows) `112943180113` **failure** — log shows the only failing test was `service-launchd.test.ts:8` asserting a hard-coded POSIX path on Windows (128 files otherwise passing); browser job cancelled after the failure; **OCI/recovery `112949914724` and Deploy `112949914315` skipped** — the `needs` edges demonstrably blocked downstream jobs, i.e. fail-closed behavior observed live, not just in YAML. Its macOS artifact `11502323294` was independently downloaded and also passes the gate locally (evidence for `c178b45` only).

## 4. Local reproduction on this host (macOS arm64, Node v25.7.0 — note: CI ran Node 22.23.x)

- `npm ci` — pass; `npm run verify` — exit 0; `actionlint .github/workflows/deploy-vps.yml` — pass; `git diff --check 8877a59..HEAD` — clean.
- Focused: `npx vitest run tests/cli/service-launchd.test.ts tests/ci/macos-launchd-installer-gate.test.ts` — **15/15 pass**.
- Full suite (with the CI-style trap replicated for safety): **132 files passed / 9 skipped; 1710 tests passed / 23 skipped**. The native fixture executed for real in this host's `gui/501` domain: 4 distinct commits/PIDs, canaries retained, and `defaultLabelPresentBeforeAndAfter:true` — this host genuinely has the production `cc.tokenizer.agent` loaded, and the fixture provably did not disturb it.
- Post-run hygiene verified: `launchctl list` shows no `ci.*` jobs; zero `tokenizer-macos-launchd-*` leftovers in `$TMPDIR`; `.ci/macos-launchd-cleanup.env` removed; `git status` clean.

## 5. Per-gate results

| Gate | Result | Basis |
|---|---|---|
| launchd test identity isolation | **PASS** | source review + 15/15 focused tests + fixture never touching default label on CI and on a host where it was actually loaded |
| Native fresh install / upgrade / configure-failure restore / unavailable-manifest rollback | **PASS** | CI artifact `11502379434` + job `112949917812` log + local native run, all with distinct commits and PID replacement |
| Credential / queue retention | **PASS** | byte-exact canaries asserted per phase; `...Retained:true` in CI and local observations |
| Cleanup fail-closed | **PASS** | trap + namespace guard pinned in gate test; no leftovers on runner or this host; `Refusing` guard never triggered |
| `macos-latest` job + `needs` edges | **PASS** | YAML + actionlint + live evidence: run `37665390447` skipped OCI/Deploy on failure; run `37666960517` green end-to-end with Deploy skipped only by the non-main `if` |
| Windows test-only portability fix | **PASS** | single-file test change; Windows job `112949917564` green with the previously failing test passing |
| Honest release boundary | **PASS** | manifest/tag/version/installer/public/prisma verified byte-unchanged; generator handoffs self-mark NOT_READY |

## 6. Realistic limitations — CI fixture ≠ signed Agent release

1. Fixture uses a **loopback manifest server and local git remote**; the real `/api/agent/releases` endpoint, manifest/tag publication, and GitHub release retention are unverified — and manifest/tag were not touched by this slice.
2. Windows service coverage still **stubs `schtasks`** (`tests/cli/agent-release-installer-windows.test.ts:85`); real Task Scheduler install/upgrade/rollback remains open.
3. No **destructive fault matrix**: SIGKILL/power loss mid-cutover, disk-full, permission faults, corrupt plist, failed `launchctl load`, sleep/wake are untested; the only injected fault is `configure` exiting 42 post-cutover.
4. No **packaging, signing, notarization**; the agent runs via `tsx` from a source checkout.
5. Credentials/queue are pre-seeded with privacy paused: retention is proven, **live enrollment, token rotation/revocation, heartbeat delivery, and upload acknowledgement are not**.
6. Headless/SSH sessions without a GUI domain fail closed by design; such environments need a controlled native runner, not a mock.
7. `macos-latest` is a moving runner image; the exact macOS version is not pinned by this gate.

## 7. Verdict

The B04 macOS launchd CI slice at `d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f` is **accepted as a test/CI slice**: the isolation design is sound, the native lifecycle evidence is real and reproduced on two independent macOS environments, cleanup is fail-closed, and the pipeline wiring demonstrably gates artifacts and deploy.

**`release_ready`: false.** Per section 6, real manifest/tag publication, real Windows Task Scheduler execution, the destructive platform matrix, and signing/packaging/production rollout remain open. This verdict does not approve release.

## 8. Reproduce

```bash
git rev-parse HEAD                       # d1d4bb10b80b7a8a61a82e5a3032f26ddddfd37f
git diff --stat 8877a59..HEAD
gh run view 37666960517 --repo tripplemay/tokenizer --json headSha,status,conclusion
gh api repos/tripplemay/tokenizer/actions/runs/37666960517/jobs
gh run download 37666960517 --repo tripplemay/tokenizer -n macos-launchd-pinned-installer -D /tmp/b04-eval
node scripts/ci/assert-macos-launchd-installer.mjs /tmp/b04-eval/macos-launchd-installer.json
gh run view 37665390447 --repo tripplemay/tokenizer --json status,conclusion,jobs
gh api repos/tripplemay/tokenizer/actions/jobs/112943180113/logs | grep -A3 "FAIL"
npm ci && npm run verify
npx vitest run tests/cli/service-launchd.test.ts tests/ci/macos-launchd-installer-gate.test.ts
actionlint .github/workflows/deploy-vps.yml
```
