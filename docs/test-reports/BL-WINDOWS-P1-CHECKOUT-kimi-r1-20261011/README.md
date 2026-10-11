# BL-WINDOWS-P1-CHECKOUT-SUPPORT - fresh Kimi r1 offline supporting evaluation

Fresh independent registered Kimi-family OFFLINE supporting Evaluator (harness-rules.md
section 1.5). Candidate commit `221f2f87d94db1656e3000662796d79621b696f5` (parent
`54af183617ed06c18edd42632326dbfd09451456`, verified via `git rev-parse` in the evaluator
worktree). Immutable runtime baseline: source888 `888a5acd7a8a441c9ec4ad898453f149cf8d6b7c`.
This is **offline supporting evidence only** - not Compose HARD_STOP resolution, not formal
F004/F005 acceptance, not native/Windows feasibility, not provenance of a native run, not
release acceptance. No push, no state/gate/memory edits, no CI trigger were performed.

## Environment (owned, isolated)

- Node `v22.22.0` (`/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`), npm 10.9.4, PATH
  restricted to the Node dir plus `/usr/sbin:/sbin:/usr/bin:/bin`.
- Before any imports/tests: `HOME=USERPROFILE=/Volumes/ORICO/project/.wp1ce-r1-20261011`,
  `TMPDIR` and npm cache beneath it. No real home, system tmp, queue or symlinked dependency use.
- Fresh `npm ci` in this worktree only: exit 0, 670 packages added, 672 audited.
  stdout/stderr preserved in the npm ci task log - **7 high severity vulnerabilities**
  reported by npm audit (audit inquiry not performed; no `npm audit fix`, no dependency
  changes). Deprecation warnings: `prebuild-install@7.1.3`, `eslint@9.39.5`. Package lifecycle
  downloads (Prisma/better-sqlite3) are not separately observable in the captured log; no full
  network isolation is claimed. Egress was limited to `registry.npmjs.org` plus package-owned
  lifecycle fetches; no manual downloads, global installs or credential/SSH/Docker/DB access.

## Exact identity and byte projections (independently re-derived)

| File | Expected SHA-256 prefix | Observed | Result |
|---|---|---|---|
| `.github/workflows/windows-p1-stages-diagnostic.yml` | `1ab508fc...83a771` | match | PASS |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json` | `652a1117...ed1922d` | match | PASS |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md` | `fc7f4d09...025ec6` | match | PASS |
| `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | `3028d779...c56e4f6` | match | PASS |
| `tests/diagnostics/windows-p1-stages.test.ts` | `7718f1e6...289132` (unchanged) | match | PASS |

- Workflow: source888 bytes + the single declared replacement (four added `env` lines under
  the checkout step, `GIT_CONFIG_COUNT: '1'`, `GIT_CONFIG_KEY_0: core.longpaths`,
  `GIT_CONFIG_VALUE_0: 'true'`, all YAML strings) reproduce the candidate exactly.
- Bindings JSON: exactly the five declared replacements, each before-string occurring exactly
  once in source888 and each after-string exactly once in the candidate; any 4-of-5 partial
  application does not reproduce the candidate.
- Bindings MD: candidate = source888 bytes + exactly the declared C001 appendix (3011 bytes).
- CLI: masking exactly the two identity literals (`bindingHash`, `mdHash`) yields bytes
  identical to source888; masking only one literal, or adding one extra byte, does not.
- `git diff --name-only source888..HEAD` = exactly the 4 candidate paths + 4 declared
  plan/pre-scope report paths. Full `ls-tree -rz --full-tree` inventories of source888 and
  HEAD, filtered of those 8 paths, are identical (covers frozen 10 hashes, the 57-path
  historical archive tree and every other tracked record). Scoped `git status` on the 11
  source paths is clean.

## Unchanged controls run by this evaluator (fresh dependencies)

- `node node_modules/vitest/vitest.mjs run tests/diagnostics/windows-p1-stages.test.ts
  --reporter=json --outputFile=<owned report path>`: exit 0, **81/81 passed**, 0 failed,
  0 pending. All 14 `required_future_controls` describe blocks present and passing. Raw
  JSON/stdout/stderr in `raw/unchanged81.*`. The unchanged `checksSummary` validator accepts
  this raw report (`allRequiredControlsPassed: true`, `releaseAcceptance: false`) - exercised
  inside my own suite.
- `npm run verify` (`prisma generate && tsc --noEmit`): exit 0, both before and after adding
  the new evaluator test file (raw logs `raw/npmrunverify*.stdout/stderr.txt`).

## Own additive checks (tests/evaluator/windows-p1-checkout-r1-20261011.test.ts, 59/59 pass)

Compact table-driven, derived independently (no reuse of the previous evaluator's tests,
outputs or conclusions):

1. HEAD/parent identity; five file hashes; exact 8-path diff closure; filtered tree-inventory
   equality; ten prior/frozen hashes vs disk bytes; scoped clean status.
2. Exact byte projections above, re-derived in-test from source888 via `git show`.
3. Checkout-env exact-byte confinement oracle (byte identity vs the declared candidate hash -
   **not** a YAML parser): positive on the real workflow; 30 negatives across missing env,
   count `'0'`/`'2'`, second pair, duplicate/extra key, non-string scalars, false value,
   workflow/job/later-step (setup-node, prepare, npm ci, synthetic, INITIAL, seal, verify,
   upload) leakage, `GITHUB_ENV` write, global/system config writes, sparse/path changes, new
   command probe, secret reference, permissions broadening, continue-on-error, event/ref
   change, upload-path alteration - each verified to differ and to fail the oracle.
   Line-level structural positives confirm the env block sits only in the checkout step.
4. Binding identity: CLI literals equal on-disk JSON/MD SHA-256 (positive provenance); stale
   old-source literals mismatch candidate documents and vice versa. Owned-mirror
   child-process imports of the **unchanged** CLI: baseline import + `validateBindings()`
   passes; JSON one-byte mutation, stale CLI relabelled from source888,
   stale-json-literal-only and stale-md-literal-only, and MD one-byte mutation are each
   rejected (non-zero exit, expected assertion markers). A one-extra-CLI-byte case is covered
   by the exact-scope mask check (the runtime import hashes the binding documents, not the
   CLI itself - stated honestly).
5. Environment admission: unchanged exported `systemEnvironment` keeps only the five admitted
   system keys (case-insensitive) and discards all three checkout keys plus unrelated keys;
   ambiguous case duplicates and non-string values throw. Bindings data: `extra_keys` is
   `[]`, no checkout key among the 22 synthetic keys. Unchanged `validateProvenance` accepts
   a schema-valid provenance and rejects GIT_CONFIG_* key injection (swap and addition),
   non-empty `extraEnvironmentKeys`, and a stale source-file hash. `fixedEnvironment`/guard
   extra-key closure is asserted **statically** (source contains the exact deepEqual
   closure) - labeled static, not claimed as runtime enforcement.
6. Disposable owned Git fixture (owned empty global config, `GIT_CONFIG_NOSYSTEM=1`, owned
   XDG/HOME/TMPDIR, fully explicit child env): with the three checkout keys, `git config
   --get core.longpaths` returns `true` with `--show-origin` = `command line`; a sibling
   child without the keys sees it unset; the owned global config stays empty, `.git/config`
   bytes are unchanged (no persistence), XDG dir stays empty. This demonstrates the
   command-scope mechanism only - **not** Windows built-in longpath feasibility.
7. My real unchanged-81 raw report validates through the unchanged `checksSummary` validator.

## Boundaries preserved

Windows INITIAL/native regressions, Compose HARD_STOP, provider/encrypted-backup/custody/
DB-TCP/password/Agent/homepage/deploy gates all remain open. No publication or CI was
executed; only the Coordinator may separately authorize one exact-source non-main CI after a
sufficient gate.

## Correction record (immutable failed runs preserved)

- `npm run verify` attempt 2 (first run including my new test file): **exit 2**, tsc errors
  TS2769 at `tests/evaluator/windows-p1-checkout-r1-20261011.test.ts(53,46)` and `(253,9)` -
  this project's `ProcessEnv` type requires `NODE_ENV`, which my child-env literals omitted.
  Full logs preserved unchanged at `raw/npmrunverify-attempt2-EXIT2.{stdout,stderr}.txt`.
- `npm run verify` attempt 3 (after adding `NODE_ENV: 'test'`): **exit 2**, TS2322/TS2345 -
  the repo types `NODE_ENV` as the literal union `"test" | "development" | "production"` and
  my object literals widened to `string`. Logs at `raw/npmrunverify-attempt3.*`.
- Legitimate correction (my own test file only: `NODE_ENV: 'test'` added and the two env
  consts annotated `NodeJS.ProcessEnv`; no product/spec/workflow/original file touched).
  Final runs: my suite `raw/r1-own-attempt3.*` (exit 0, 59/59) and `npm run verify`
  attempt 4 `raw/npmrunverify-attempt4.*` (exit 0; direct `npx tsc --noEmit` also exit 0).
  Pre-fix own-suite raw preserved as `raw/r1-own-attempt1-pretypefix.raw.json` plus
  `raw/r1-own-attempt2.*`. All attempts remain in `raw/`; no evidence was deleted,
  tail-trimmed or rerun-to-green without disclosure.
