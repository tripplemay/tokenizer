# B06 independent Evaluator report — bounded server batch schema + PG16 CI gate

- **Evaluator:** Kimi-family independent Evaluator (external CLI, fresh context, different model family from the Codex Generator)
- **Candidate HEAD:** `029f6c53ea7193989643a1f2e4d23108ba0c9af5` (verified `git rev-parse HEAD` in this isolated no-remote clone; `git remote -v` empty)
- **Baseline used for diff:** `c497248` (B06 resume checkpoint, immediately before the candidate commits `b8033d5` → `029f6c5`)
- **Date:** 2026-10-08
- **Scope (per dispatch):** server admission / reject-before-write / old-Agent compatibility of the B06 bounded-batch slice, plus the PostgreSQL 16 CI gate. Client quarantine / partial ACK / liveness is **not in this candidate** and is **left OPEN** (§6).
- Generator handoffs (`docs/test-reports/B06-bounded-schema-20261007/`, `docs/test-reports/B06-pg16-ci-gate-generator-20261008/`) were treated as **claims to verify, not proof**. Every verdict below rests on my own inspection, my own probe suite, live GitHub API/log fetches, and a locally reproduced PG16 run.

## 1. What the candidate changes (independently established)

`git diff --name-only c497248..HEAD` (verified by me):

| Area | Files |
| --- | --- |
| Product source | `src/server/batch-input.ts` (new, shared validator), `app/api/usage/events/batch/route.ts`, `app/api/quota/snapshots/batch/route.ts` |
| CI | `.github/workflows/deploy-vps.yml` (verify-db job only) |
| Tests | new: `tests/server/batch-schema.test.ts`, `tests/server/batch-wire-compatibility.test.ts`, `tests/server/b06-batch-db.probe.test.ts`, `tests/cli/b06-batch-failure-queue.test.ts`, `tests/ci/b06-pg16-workflow-gate.test.ts`; modified expectations: `tests/server/usage-batch-input.test.ts`, `tests/evaluator/bl-security-p1-f008-probes.test.ts` (F003 poison-2xx → poison-400) |
| Docs/evidence | generator spec + handoff artifacts |

Confirmed **not** changed: `src/cli/`, `src/quota/`, `src/shared/`, `prisma/`, `public/`, `bin/`, `progress.json` / `features.json` / gates, release manifests. `git status --short` is clean except this report directory.

## 2. Per-gate verdicts

| # | Gate | Status | Basis (all evidence in `evidence/`) |
| --- | --- | --- | --- |
| G1 | Admission ordering: auth → token/device tenant binding (403) → bounded body read → full batch validation → explicit device match (403) → writes | **PASS** | Code read of both routes; my probes: 401 with `bodyUsed === false`, 403 with `bodyUsed === false`, no write calls on any rejection |
| G2 | Body/transport bounds: `application/json` only, ≤1,048,576 **actual** bytes, Content-Length as early hint only, fatal UTF-8, safe 400 on malformed/truncated/stream-error | **PASS** | 1MiB±1 byte exact pair; forged small declared length + 1MiB+1 stream → `body_too_large`; declared-over-cap early reject; malformed declared lengths; split multibyte UTF-8 accepted / bad continuation rejected |
| G3 | JSON complexity: depth ≤32 (root 0), ≤100,000 visited values, finite numbers, no NUL/unpaired surrogates in keys or strings | **PASS** | Exact boundary pairs 32/33 and 100,000/100,001; `1e400`; `\u0000` in key and value; `\ud800`/`\udfff`; duplicate keys last-wins; `__proto__` key creates own property, prototype unpolluted |
| G4 | Row/field bounds per spec table (usage 200 / quota 100 rows; source & provider enums; PG Int32 token counts; fallback-sum overflow; costUsd < 1e10 exclusive; safe-integer BigInt; codex six cumulative counters ≤ MAX_SAFE; UTC calendar dates with rollover/leap-second/offset/date-only/year-0000 rejections; string length/control-char matrix; device + diagnostics incl. strict harness parser; timezone via Intl; rawJson ≤64KiB depth ≤8) | **PASS** | 111 independent adversarial tests, incl. boundary-exact pairs (200/201, 100/101, 2³¹−1/2³¹, MAX_SAFE±1, depth 8/9, 65,536/65,537 bytes) and zero-based `row` indices (0, 1, 199); envelope errors omit `row` |
| G5 | Reject-before-write against real PostgreSQL 16: no timezone/device/token/project/event/quota/cache/pricing writes on any invalid request | **PASS** | My `independent-db.test.ts` (4 tests) against a real scratch PG 16.13 (UTC): full persisted state (user.timezone, device.name/lastSeenAt/lastSyncAt, token.lastUsedAt, event/snapshot/project counts) byte-identical after 20+ adversarial requests across both routes incl. 403/401 paths; positive control proves the state snapshot is not vacuous (valid batch advances lastSyncAt/lastUsedAt) |
| G6 | Whole-batch 400 contract + old-Agent compatibility: fixed codes, no echo of values/errors/payload, safe 400 (never thrown 500), empty batches stay 200, current usage/quota agent wires accepted, tenant binding from token only, BigInt exact (baseline `Math.round` removed), B03 privacy minimization intact, agent throw-on-400 preserves the durable queue | **PASS** | Error-shape assertions on every rejection (canary never echoed); empty usage POST advances sync state with zero event rows (ingest early-return, verified in `src/server/ingest.ts:146`); empty quota POST 200 with zero writes; 200-row boundary batch persisted with Int32 max/Decimal/fallback-sum exactness and `rawJson → NULL`; quota MAX_SAFE → `9007199254740991n`; `userId`/`deviceId`/`capturedBy` injection ignored; `src/cli/sync.ts` / `src/quota/sync.ts` send `content-type: application/json`, throw on non-2xx (queue retained — generator queue test re-run by me, 1/1 pass) |
| G7 | PG16 CI gate — statics: scratch DB `tokenizer_ci_scratch`, `EVAL_B06_DB_URL === DATABASE_URL`, `TZ: UTC`, dedicated probe listed exactly once, 5 historical probes retained, no-skip floor 10→13 | **PASS** | Read of `.github/workflows/deploy-vps.yml:171-224`; `scripts/ci/assert-vitest-results.mjs` requires total ≥ floor, passed == total, 0 pending, 0 failed; `tests/ci/b06-pg16-workflow-gate.test.ts` 2/2 pass on my run |
| G8 | PG16 CI gate — GitHub run 37662917327 | **PASS** | `gh api` live fetch: `event=workflow_dispatch`, `head_branch=codex/b06-pg16-ci-gate-20261008` (safe branch), **`head_sha=029f6c53ea7193989643a1f2e4d23108ba0c9af5` (exact candidate HEAD)**, conclusion success. Jobs: Verify ✓, Verify (Windows) ✓, Verify (authenticated browser) ✓, Verify (PostgreSQL 16) ✓, **Deploy skipped** (safe branch, no production deploy). PG16 job log: real `postgres:16-alpine` → **PostgreSQL 16.15** started; `tests/server/b06-batch-db.probe.test.ts (3 tests)` ✓; **6 files, 51/51 passed, zero skips**, `Verified 51 tests with no skips or failures`. Windows log: 121 files / 1647 passed, 35 skipped, **0 failed** + native owner force-termination check + `install.ps1` parse ✓. Browser log: 3 passed |
| G9 | PG16 gate — independent local reproduction | **PASS** | Fresh scratch cluster (initdb, PG 16.13, UTC) + `prisma migrate deploy` (28 migrations) + exact 6-file workflow command → **51/51 passed, zero skips**, assert floor 13 PASS; negative control (EVAL_* unset) → 38 passed / 13 skipped → assert **exit 1** (`pg16-missing-env-negative.log`) — the gate genuinely cannot silently skip |
| G10 | L1 at exact HEAD | **PASS** | `npm run lint` 0 warnings/errors; `npm run verify` (prisma generate + tsc) PASS; full `vitest run`: **121 files / 1657 passed / 25 skipped / 0 failed** (macOS arm64, Node v25.7.0) — matches generator's Node 22 numbers and CI |
| G11 | Scope discipline / no out-of-slice changes | **PASS** | §1; no client production code, no schema/migration, no state/gate/release files touched; spec §"Explicit remaining blockers" honestly lists the missing client slice |
| G12 | Client poison-row quarantine / partial ACK / rejected IDs / good-row liveness / repair-replay | **OPEN** | Explicitly not in this candidate (spec §"Explicit remaining blockers"); per dispatch this stays open. A poisoned batch can still pin good queued neighbours; whole-batch 400 prevents silent loss but not queue stall |
| G13 | Production deploy + post-deploy verification | **NOT EXERCISED** | Deploy job correctly skipped on the safe-branch run; no push to main, no deploy, no post-deploy health check was performed or attempted by me |

## 3. Findings / observations (none blocking)

1. **Behavior tightenings are deliberate and spec-documented** (spec §"deliberate incompatibilities"): unknown sources, coercible token strings, fractional/oversized numbers, impossible/non-UTC dates, control-character strings, oversized batches/rawJson, and wrong/missing `content-type` now 400. Baseline route also threw an unhandled 500 on malformed JSON (`await request.json()`); now a safe 400. I verified the current released agent (`src/cli/sync.ts`, `src/quota/sync.ts`) always sends `application/json`, ≤25-row usage batches, device-less quota envelope, Intl timezone, and throws on non-2xx — so these tightenings do not break the current agent; older queued poison rows will pin their batch until the client slice lands (that is G12, open by design).
2. **`quotaDepth: null` is rejected** (only `undefined` allowed) while other diagnostics fields are nullable-legacy — consistent with the current agent, which always sends a number; noted as a deliberate strictness, documented in spec only implicitly.
3. **Assert floor is a minimum (≥13), not an exact count** — the gate relies on the zero-skip requirement plus the workflow static test locking the six probe paths. Acceptable as designed; noted for future hardening.
4. Content-Length `" 100"` arrives as `"100"` (platform header trimming) — correct HTTP behavior, not a gap; documented in my probe.
5. `BigInt(Math.round(...))` → `BigInt(...)` on the quota route is a real behavior fix (baseline silently rounded fractional/unsafe doubles); combined with the safe-integer bound, conversion is now exact (verified `9007199254740991` → `9007199254740991n` in a real DB row).

## 4. Reproducible commands

```bash
# Candidate identity (this clone has no remotes by design)
git rev-parse HEAD                      # 029f6c53ea7193989643a1f2e4d23108ba0c9af5
git diff --name-only c497248..HEAD      # change surface (§1)
npm ci && npm run lint && npm run verify && npm run test

# Independent evaluator probes (this directory; Node v25.7.0, macOS arm64)
npx vitest run --config docs/test-reports/B06-kimi-evaluator-20261008/vitest.independent.mts \
  docs/test-reports/B06-kimi-evaluator-20261008/independent-adversarial.test.ts   # 111/111

# Real PG16 scratch (Homebrew postgresql@16 16.13, UTC, /tmp cluster)
initdb -D /tmp/pg -U postgres --encoding=UTF8 --locale=C -A trust
pg_ctl -D /tmp/pg -l log -o "-p 55439 -c timezone=UTC -c listen_addresses=127.0.0.1" start
createdb -p 55439 -h 127.0.0.1 -U postgres b06_kimi_scratch
U=postgresql://postgres@127.0.0.1:55439/b06_kimi_scratch
DATABASE_URL=$U npx prisma migrate deploy
DATABASE_URL=$U KIMI_B06_DB_URL=$U npx vitest run --config docs/test-reports/B06-kimi-evaluator-20261008/vitest.independent.mts \
  docs/test-reports/B06-kimi-evaluator-20261008/independent-db.test.ts            # 4/4

# Exact workflow PG16 matrix locally (51/51, zero skips; assert exit 0)
env TZ=UTC DATABASE_URL=$U EVAL_B06_DB_URL=$U EVAL_F003_DB_URL=$U EVAL_F004_DB_URL=$U \
    EVAL_F005_DB_URL=$U EVAL_F007_DB_URL=$U EVAL_DB_URL=$U \
    npx vitest run tests/server/b06-batch-db.probe.test.ts tests/server/quota-account-db.probe.test.ts \
      tests/server/harness-gates-route-db.probe.test.ts tests/server/harness-cost-range-db.probe.test.ts \
      tests/evaluator/bl-cost-batch-v1-f003-cachekey-db.probe.test.ts \
      tests/evaluator/bl-security-p1-f008-probes.test.ts \
      --reporter=default --reporter=json --outputFile=.ci/db-probes.json
node scripts/ci/assert-vitest-results.mjs .ci/db-probes.json 13
# Negative control: same command with EVAL_* unset → 13 skipped → assert exit 1

# GitHub run verification (read-only API)
gh api repos/tripplemay/tokenizer/actions/runs/37662917327
gh api repos/tripplemay/tokenizer/actions/runs/37662917327/jobs
gh api repos/tripplemay/tokenizer/actions/jobs/<pg16-job-id>/logs
```

Scratch cluster was stopped and removed after the runs; nothing outside this report directory was written (except ephemeral `node_modules/` from `npm ci` and `/tmp` scratch).

## 5. Limitations

- Local DB used Homebrew PostgreSQL **16.13**; CI used `postgres:16-alpine` (**16.15**). Same major line; the Int/Decimal/BigInt semantics exercised are version-stable within PG16.
- Local runtime Node **v25.7.0** vs CI Node 22 — both fully green; no version-sensitive divergence observed.
- Deploy job was correctly skipped on the safe branch; production deploy, post-deploy `/api/health` SHA alignment, and the human gate were not exercised (by design of this evaluation).
- My mocked-boundary probes assert "no write calls" at the module boundary; the real-DB probes assert persisted state directly. Both layers agree; route-handler level testing does not exercise the Next.js HTTP stack itself (CI build smoke + browser job cover that layer).
- Playwright/browser suite not re-run locally; CI job log used as evidence (3 passed).
- I did not evaluate any client-side quarantine/partial-ACK/liveness behavior (G12) — out of candidate scope.

## 6. Bottom line

All in-scope production gates that **can** be proven for this candidate **are** proven: the server slice admits exactly the documented wire, rejects everything else as a whole-batch, echo-free, safe 400 **before any persisted side effect**, stays compatible with the current released agents, and the PG16 CI gate genuinely executes the three dedicated probes with zero skips at the exact candidate SHA on a safe branch with Deploy skipped.

`release_ready: false`, for two honest reasons: (1) this is explicitly an **isolated server slice**, not full B06 — client quarantine / partial ACK / good-row liveness (G12) remain open and a poison row can still pin good queued neighbours; (2) the **production deploy path and human gate (G13) were not exercised**. Neither is a defect in the candidate; they are the declared boundaries of this evaluation.
