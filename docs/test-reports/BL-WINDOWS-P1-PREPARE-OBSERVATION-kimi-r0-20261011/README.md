# BL-WINDOWS-P1-PREPARE-OBSERVATION — fresh independent OFFLINE supporting evaluation (kimi-r0)

Role: fresh independent registered Kimi-family OFFLINE supporting Evaluator (proposal gate 4 analogue),
batch `BL-WINDOWS-P1-PREPARE-OBSERVATION-SUPPORT`, feature F004, task
`windows-p1-prepare-observation-712cf21-kimi-r0`. This PASS is **OFFLINE supporting only** — it is
not a native Windows finding, not formal F004/F005 acceptance, not full-release or dependency-security
acceptance, and it grants no CI/publication authority. The original Windows prepare root cause remains
**unknown** until a separately authorized single new-source CI observation, which only the Coordinator
may authorize; this evaluator never publishes or executes CI.

## Pinned identities (independently recomputed)

- Candidate source: `712cf210b089dc71f3a6e6ed2e19e1de7fee57da` (worktree HEAD, parent `27dd6bc`).
- Baseline: `61cf64e67a6fda231bb090e77c19d5ececb908af`.
- Sole modified CLI: `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`
  actual sha256 `c245a528fb8549915396b5f052bf3841f35b03d88d6b7b5e91982b6f0f07dc4f` (matches pinned);
  baseline sha256 `6548ea1cbf7584873f61b4cb396bc9d4ce8567c672d23313b56a38e8ce0d3bae`.
- Unchanged original test: `tests/diagnostics/windows-p1-stages.test.ts`
  actual sha256 `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132` (matches pinned).
- Whole tracked tree vs baseline61: exactly 1 modification (the CLI above) + 9 declared Planner /
  pre-scope report additions (`git diff --name-status`); no other delta. `vendor/` untouched.

## Environment (owned, fresh, single install)

- `PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:/usr/sbin:/sbin:/usr/bin:/bin`,
  owned `HOME=USERPROFILE=/Volumes/ORICO/project/.wp1poe-r0-20261011`, `TMPDIR` + npm cache beneath it
  (see `raw/env-before-npmci.txt`). Node v22.22.0 / npm 10.9.4.
- One fresh `npm ci` in this worktree: exit 0, 670 packages (`raw/npm-ci.stdout.txt`,
  `raw/npm-ci.stderr.txt`, `raw/npm-ci.status.txt`). **7 high severity vulnerabilities remain**
  (expected raw warning; no audit fix / no extra installs performed or implied).
- Package-owned lifecycle scripts observed in npm debug log (preserved verbatim in
  `raw/npmcache-logs/`): `prisma@5.22.0 preinstall`, `@prisma/client@5.22.0 postinstall`,
  `@prisma/engines@5.22.0 postinstall`, `@swc/core@1.16.13 postinstall`, `esbuild@0.28.2/0.25.12
  postinstall`, `unrs-resolver@1.11.1 postinstall` (napi-postinstall), `better-sqlite3@12.10.0
  install` = `prebuild-install || node-gyp rebuild --release`; all logged exit 0. Per contract this
  evaluator does **not** claim no-fallback / all-lock-only / native-installed from exit codes or
  stdout silence; the debug logs are the preserved evidence.
- `node_modules/.bin` links realpath inside this worktree only (vitest/tsc/tsx/prisma sampled).
- No node_modules/caches/real-home/queues/system-tmp/manual links were borrowed; no authenticated
  GH/Actions/push/deploy/secret/SSH/Docker/DB access; no target CLI prepare/run/probe/seal/
  verify-upload or old diagnostic execution; no real Windows/PowerShell/OS-PID/process.kill/native
  probes. `git show`/`git diff` were read-only VCS inspections.

## Checks and results (all raw outputs under `raw/`, full not tail-only)

1. Tree/byte identity: as pinned above; diff hunks eyeballed against the locked Planner projection —
   module-local non-exported `let prepareFailurePhase = null` + 13 literal 29-byte lines; P00 only in
   the exact `same(args, ['--prepare'])` branch; P01–P12 assignments immediately before the specified
   operations; success reset to `null`; second `sourceFiles()` pass only split into
   `const prepareSourceFiles` before the unchanged `validateProvenance` assertion; terminal catch keeps
   the original 51-byte generic message + `exitCode = 1` and appends at most one fixed 29-byte
   allowlisted lookup line (max 80 bytes), invalid/unassigned state only to P00.
2. Static recovery: removing the permitted slots from the candidate yields baseline61 exactly
   (whitespace-stripped byte comparison, `raw/static-verify2.json`); both 64-hex binding identity
   literals unchanged; stdout write count unchanged; no CR bytes.
3. Unchanged original controls: `npx vitest run tests/diagnostics/windows-p1-stages.test.ts` →
   **81/81 passed**, exit 0 (`raw/oldtest.*`).
4. `npm run verify` (prisma generate + tsc --noEmit) → exit 0 both before and after adding the own
   test file (`raw/verify.*`, `raw/verify2.*`).
5. Own additive evaluation `tests/evaluator/windows-p1-prepare-observation-r0-prepare-phase.test.ts`
   → **40/40 passed on the first and only run**, exit 0 (`raw/owntest-run1.*`; no initial failure
   occurred, so there is nothing to preserve beyond that run and no rerun-to-green took place):
   - static byte controls vs baseline61 (zero violations on the pinned candidate);
   - actual-source-slice VM behavior: the real pinned state block, `prepare()` body and terminal
     try/catch sliced verbatim into a fully stubbed test-local `node:vm` (no real fs/child/OS/worker/
     kill/native effects) — forced synthetic throw at each of P01–P12 yields exactly
     `windows-p1-initial diagnostic evidence unavailable\n` + `TW_P1_PREPARE_FAILURE_V1:Pxx\n`
     (80 bytes, one line, exit 1), preserved operation call order/count, both source read passes
     proven (P10 second-pass failure after first pass succeeded), success silence + phase reset,
     non-prepare/probe/import/guard silence, invalid/unassigned state (`P99`, empty, lowercase,
     truncated) mapping only to fixed P00-as-unknown, privacy proven with canary-laden errors whose
     message/stack/name getters throw on read — never read, never serialized;
   - 14 negative mutant controls rejected (reordered/after-operation phase, 28-byte/CRLF/CR literal,
     duplicate catch line, extra P13, dynamic catch content, missing success reset, P00 outside
     prepare branch, removed second source pass, changed identity literal, altered generic message,
     widened stdout).

## Scope honesty

Mock/pure/static results above characterize only the pinned source bytes and their behavior under a
fully synthetic harness. They say nothing about real Windows/native feasibility, and they do not
identify the original prepare failure cause, which stays unknown. Generator and pre-scope reports were
treated as claims; every acceptance-relevant fact here was recomputed independently from the actual
tree, baseline and pinned hashes.

## Timeline (1800 s hard cap honored)

- t+0s start → t+~35s spec/schema/tree read → t+~180s npm ci started (background) → t+~300s npm ci
  exit 0, postinstall evidence captured → t+~360s unchanged 81/81 green → t+~440s verify #1 exit 0 →
  t+~480s provisional state: all first-actual-evidence checks passing, own-test authoring in flight
  (this provisional note retained; had any check been incomplete at this point the verdict would have
  been PARTIAL) → t+~650s own 40/40 green first run → t+~1135s verify #2 exit 0 → final verdict
  written ~t+1150s (< 1500 s).
