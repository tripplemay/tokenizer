# BL-HOST-PREFLIGHT-OBSERVABILITY — independent Kimi-family supporting evaluation (F003)

- Evaluator: fresh independent Kimi supporting Evaluator (harness §1.5), not the Generator.
- Candidate under test: `cddb822cc2452c2042309de73064a38f0c4224cf` (`[BL-RELEASE-READINESS-F003] Add bounded Compose probe metadata`), verified via `git rev-parse HEAD` (see `07-frozen-baseline-git-evidence.log`).
- Frozen baselines checked: spec base `1f52c86`, product/script/workflow baseline `76d916b`, test-pinned parent `a5ea6e3`.
- Scope: supporting F003 Compose refusal observability only. Not formal parent F005, not native Windows acceptance, not production signoff. `release_ready=false` unchanged; progress.json/features.json/pending_gate untouched.
- Environment: Node v22.22.0 + npm 10.9.4 from `/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`; jq 1.7.1; synthetic `HOME`/`TMPDIR`/npm cache under `/Volumes/ORICO/project/.hpoke-20261009` (system disk near full); no production/SSH/Docker hosts, credentials, network or DB targets touched; all Docker/SSH/tool interactions are local synthetic stubs.

## Raw evidence files

| File | Content | Result |
|---|---|---|
| `01-environment-and-npm-ci.log` | versions + fresh `npm ci` (670 packages). Note: the `cd` line in the initial background wrapper failed harmlessly (mistyped absolute path); the session cwd was already the worktree, verified by `pwd` and `node_modules` landing in-repo | npm ci exit 0 |
| `02-verify-prisma-tsc.log` | `npm run verify` (prisma generate + tsc --noEmit) | exit 0 |
| `03-vitest-existing-host-preflight.log` | existing tests executed unchanged: `tests/ci/vps-host-preflight.test.ts` + `tests/ci/vps-host-preflight-observability.test.ts` | 75/75 passed, exit 0 |
| `04-typecheck-with-evaluator-test.log` | fresh `tsc --noEmit` including the new evaluator test file | exit 0 |
| `05-vitest-evaluator-controls.log` | **retained initial failure** of own controls: 2 failed / 39 passed — both failures were evaluator harness bugs (accumulating CALLS file across two runs in one `it`; an over-narrow added-line allowlist missing the semver recheck/`fi` lines), not candidate defects | exit 1 (retained) |
| `06-vitest-evaluator-controls-corrected-rerun.log` | corrected rerun of the identical suite after harness fix | 42/42 passed, exit 0 |
| `07-frozen-baseline-git-evidence.log` | HEAD pin, changed-file set, full script/workflow diff vs `76d916b` | only 3 allowed files changed |
| `08-real-workflow-validator-filter.txt` | the real jq validator extracted from `.github/workflows/deploy-vps.yml` | used verbatim in all gate controls |

## Own synthetic controls (tests/evaluator/host-preflight-observability-kimi-support.test.ts, 42 controls)

Derived independently from spec/script/workflow bytes; distinct stub implementation and validator extraction from the Generator's suite.

- Unchanged Compose argv/bounds: recorded calls prove exactly `timeout --signal=KILL 5s docker compose version --short` piped to `head -c 16385`, same as the frozen `query()` expansion; 5s bound on every query.
- Whole pipeline exit retention: statuses 1/2/23/124/137/141/255 recorded verbatim (never normalized to 1); rightmost failing stage recorded (docker 7 + head 141 → 141); valid semver + nonzero exit → `command_failed`.
- Cap priority: oversized output wins over pipeline status 0/1/141 → `output_bound_exceeded`, `captured_bytes=16385`.
- Byte counting: `é\n` → 2 bytes and `é`×8192 → 16384 bytes under `LC_ALL=en_US.UTF-8`; mid-codepoint truncation at 16385; trailing-newline stripping (`v2.35.1\n\n\n` → 7).
- Hung query bounded <9s → `command_failed/124/0`.
- `not_run` null metrics on platform/docker/invalid-input refusals; zero tool calls on invalid input; no Compose query issued before its branch.
- HOME: unset → `home_present:false`; `''` → true; synthetic canary path → true; canary path/value never appears in any output.
- No later queries and no mutation after refusal (docker calls stop at compose; no stat/sha256sum/curl; `files:{}`; deploy tree byte-identical).
- Missing-jq minimal refusal unchanged, has no `compose_probe`, and is rejected by the real validator.
- Behavioral identity vs frozen baseline script: same exit status, same call sequence, same report minus `compose_probe`/`timestamp`.
- Real validator (extracted verbatim from the workflow, real jq): accepts all five fixed classifications with consistent null/range relations (incl. `output_bound_exceeded` with pipeline 0); rejects missing/extra keys, non-object probes, invalid enums, wrong types, out-of-range values, fractions (0.5/7.5), all null-relationship violations, raw secret canaries, foreign `source_sha`; pre-existing allowlists not weakened (18 old-clause rejection controls).

## Frozen-boundary verification

- Changed files `a5ea6e3..HEAD`: exactly `.github/workflows/deploy-vps.yml`, `scripts/ci/vps-host-preflight.sh`, `tests/ci/vps-host-preflight-observability.test.ts`.
- Script diff: exactly 2 removed lines (old compose query/validation) + 16 added lines, all inside the fixed metadata block; `query()` body byte-identical.
- Workflow diff: 1 removed + 9 added lines, all inside the validator; every byte outside the validator identical to baseline.
- Old tests, `progress.json`, `features.json`, `harness-rules.md`, `AGENTS.md`, `CLAUDE.md`, `generator.md`, `package.json`, `package-lock.json`, `vitest.config.ts`, spec: sha256-pinned to baseline blobs.

## Explicitly left open (per commission)

Actual host Compose cause/predecessor identity, Windows/all final native release gates, formal F005, real encrypted dmitsvr backup/isolated recovery, PostgreSQL TCP password proof/protected Secret, Agent distribution, original homepage production freshness. `release_ready=false`. Fixed metadata does not prove HOME caused the missing Compose; 124/137/141 are recorded as numbers, not proof of timeout/cleanup/plugin causes.
