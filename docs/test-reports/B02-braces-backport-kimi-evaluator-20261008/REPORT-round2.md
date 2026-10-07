# B02 braces backport — independent Evaluator report, round 2 (CI evidence update)

Date: 2026-10-08
Role: independent Evaluator (Kimi, cross-family). This file is **additive**: round-1
`REPORT.md` and `verdict.json` are preserved unchanged.
Method: every claim below was verified by the evaluator directly against the GitHub API /
`gh` CLI (`-R tripplemay/tokenizer`) — run metadata, job/step conclusions, raw job logs,
artifact download, hash recomputation, and execution of the in-repo verification tool.
The user's descriptions were treated as leads, not as evidence.

## New evidence verified

### Run 37660012749 — exact B02 candidate

- `gh run view 37660012749`: `workflow_dispatch` on branch
  `codex/b02-backport-composed-ci-20261008`, **headSha =
  `b6092cd82f511101f3675c680e36972098b49998`** (exact round-1 candidate SHA), run
  conclusion **success**.
- Jobs (all verified individually, zero failed steps in any job):
  | Job | Conclusion |
  |---|---|
  | Verify (Lint, Typecheck, unit tests, contract tests, Next.js build) | success |
  | Verify (Windows) | success |
  | Verify (PostgreSQL 16) | success |
  | Verify (authenticated browser: production server build, Chromium journeys) | success |
  | Deploy | skipped |
- Windows job raw log (job 112925181228): native `npm ci` succeeded with the
  `file:vendor/braces` link ("added 669 packages… 7 high severity vulnerabilities" —
  the same advisory-identity residual); full `npm run test` = **123 files passed / 8
  skipped, 1602 tests passed / 33 skipped (1635)** — including the previously
  timing-out 23-repository harness test under its new 30 s allowance. This is the job
  that failed at the base SHA in run 37656814992; it is now green on the exact
  candidate.
- Deploy skip is structural, not incidental: the workflow's Deploy job condition at the
  composed SHA (line 502) is `github.ref == 'refs/heads/main' && …`; both runs executed
  on `codex/*` branches, so no deployment could occur.

### Run 37661734545 — composed candidate (B02 + B04/B05)

- `gh run view 37661734545`: `workflow_dispatch` on branch
  `codex/b02-b04-b05-composition-ci-20261008`, **headSha =
  `5b34204931a919166d8912716cac21dafea92108`**, conclusion **success**.
- Jobs: Verify, Verify (Windows), Verify (PostgreSQL 16), Verify (authenticated
  browser), **Linux OCI and recovery rehearsal** — all success; Deploy skipped.
- Windows job (112931455261): native `npm ci` OK (669 packages), full suite **1666
  passed / 61 skipped (1727)**, zero failures.
- OCI/recovery job (112933086431) steps: candidate app build, exact migration artifact,
  previous-source app and migration builds, **backup/restore/migration + old-image
  business rehearsal**, evidence stage/retain/download/verify — all success. The three
  attestation/provenance steps were **skipped** (safe-branch context,
  `provenanceRequired: false`) — see boundaries below.
- Ancestry check (`compare b6092cd...5b34204`): **diverged — ahead 30, behind 3**. The
  composed commit is *not* a descendant of the B02 candidate; the composition was
  rebased. B02 equivalence is therefore established at **file level**, not by ancestry:
  in the 300-file compare list, `vendor/braces/**`, `package.json`,
  `package-lock.json`, `tests/vendor/braces-backport.test.ts`,
  `tests/cli/harness.test.ts`, and `scripts/test/probe-braces-*.cjs` are all **absent**
  (identical between the trees). The only B02-path differences are
  `docs/test-reports/B02-braces-backport-generator-20261008/*` documentation. The
  non-docs delta (10 files) is the B04/B05 scope: Dockerfile, docker-compose*.yml,
  .dockerignore, .gitattributes, .env.example, workflow, health endpoints.

### Artifact 11500958197 — release-recovery evidence

- API metadata verified: name `release-recovery-5b34204931a919166d8912716cac21dafea92108`,
  belongs to run 37661734545 at the composed head SHA, not expired, digest
  `sha256:7e860299d56b1ba44a21a2e79ede11dce3484fa90877347ec302f6b3bfcf5795`.
- Downloaded to `/tmp/b02-eval/artifact`; the zip's recomputed SHA-256 equals the API
  digest exactly. All four `manifest.json` entries match recomputed SHA-256 and byte
  sizes; the dump sidecar hash matches the dump.
- Content: `.rehearsal` ledger (`commit=5b34204…`, `mode=synthetic`,
  `restore_inventory=2|2|1|1|23`, `runtime_uid=1000`, `rollback=passed`,
  `elapsed_seconds=36`); `.rollback-approved` (app image pinned by digest
  `@sha256:af392c6e…`, `previous_sha=2074991717abaf3cb34d9aad894bcd4357fefbc3`).
- The in-repo tool (`scripts/ci/recovery-evidence.mjs` fetched from the composed SHA —
  it does not exist at b6092cd) was executed by the evaluator against the downloaded
  evidence with the CI's own arguments:
  `node recovery-evidence.mjs verify <dir> 5b34204931a919166d8912716cac21dafea92108 false`
  → exit 0, `{"recoveryEvidence":"verify","revision":"5b34204931a919166d8912716cac21dafea92108","provenanceRequired":false}`.

## Reassessment: safe-branch CI readiness

Round 1 finding was **NOT_PROVEN** solely because no safe-branch run of the candidate
existed. That condition no longer holds:

- **B02 candidate `b6092cd82f511101f3675c680e36972098b49998`: safe-branch CI is now
  PROVEN GREEN** on the exact SHA — all four verify jobs including native Windows
  (install of the `file:` link, typecheck, full suite), PostgreSQL 16, and
  authenticated Chromium journeys, with Deploy correctly skipped.
- **Composed candidate `5b34204931a919166d8912716cac21dafea92108`: also green**,
  additionally covering the OCI build and synthetic recovery rehearsal; B02 substance
  is file-identical between the two trees, so the backport is exercised unchanged.

Round-1 blockers #1 is therefore discharged for both SHAs, with these standing
boundaries:

1. Both runs are `workflow_dispatch` on `codex/*` branches. A `push` to `main` is a
   different event with different job conditions (Deploy becomes eligible); it has not
   happened and is not endorsed here.
2. OCI attestation/provenance steps ran **skipped** (`provenanceRequired: false`);
   main-only signed provenance is unverified by these runs.
3. The recovery rehearsal ran `mode=synthetic` against CI fixtures. It is a release-
   recovery *rehearsal* gate, **not** an actual production backup/restore, which
   remains an independent gate.

## npm audit disposition: patched code vs unpatched residual

Question: do the seven High entries refer to already-patched vendored code, or is any
unpatched residual present?

- The audit output contains **one single advisory** (GHSA-vfj7-8cjw-p6xm, range
  `<=3.0.3`) and six transitive fan-out entries (`chokidar`, `micromatch`, `fast-glob`,
  `@next/eslint-plugin-next`, `eslint-config-next`, `tailwindcss`), each flagged only
  `via: braces`. No second advisory exists in the report.
- The installed `braces` code at both SHAs is the vendored patched copy (round-1 hash
  replay + resolution proof; both CI runs installed the same `file:` link — the Windows
  logs echo the same 7-High identity match). The stack-exhaustion behavior the advisory
  describes was demonstrated closed by patched-vs-pristine controls.
- Therefore: **all seven entries refer to one advisory whose described vulnerable code
  is, in these trees, already patched.** The entries are *true about package identity*
  (name `braces`, version `3.0.3` ∈ `<=3.0.3`) and *false about the installed code's
  actual behavior*. No entry represents a distinct, unpatched residual vulnerability.

Is a documented scanner false-positive disposition technically different from accepting
an unfixed security risk? **Yes, materially:**

| | Risk acceptance | Scanner false-positive disposition (this case) |
|---|---|---|
| Vulnerable behavior in artifact | present, exposure accepted | **absent — proven by diff, hashes, boundary/negative-control probes** |
| Evidence burden | impact analysis, compensating controls | proof the executed bytes are fixed |
| Scanner state | correctly reports a real hole | matches name+version metadata it cannot see past |
| What closes the item | owner + deadline + accepted exposure | remediation of the code; the note only explains the residual alert |

The user chose **remediation before release**: the recursion guards changed the executed
bytes, and rounds 1–2 supply the discriminating evidence (pristine RangeError vs patched
controlled SyntaxError at the same boundary, differential compatibility, install-graph
resolution, exact-SHA CI). The disposition documents a scanner artifact; it does not
waive any real exposure. Standing caveats that keep this honest:

1. The disposition is **per-tree**: it holds exactly while `vendor/braces/**`,
   `package.json`, and `package-lock.json` match the verified content. Any change there,
   or silently dropping the `$braces` override, invalidates it pending re-verification.
2. It is scoped to the advisory's stack-exhaustion vector; it asserts nothing about
   other potential `braces` issues, and upstream remains without an official fix for
   the ecosystem at large.
3. It does not remove the B02 housekeeping item: adopt a verified upstream release when
   one exists (removal trigger documented in `vendor/braces/TOKENIZER-BACKPORT.md`).

## Production release — still NOT granted

Independent gates remain open by design: F005 homepage-freshness browser verification is
pending in `progress.json`; signed provenance/attestation is main-only and was skipped
on the safe branch; the recovery rehearsal was synthetic, not an actual production
backup/restore; no `push` to `main` has occurred from these runs. This evaluator grants
no release acceptance and performed no commit, push, or deployment.

## Evidence boundary statement

Round-1 artifacts were not edited. No product code, tests, package files,
`progress.json`, `pending_gate`, or Git configuration was modified. Downloads and the
verification tool ran under `/tmp/b02-eval` only. Local checkout remains at
`b6092cd82f511101f3675c680e36972098b49998`; the composed tree was inspected exclusively
through the read-only GitHub API.
