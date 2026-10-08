# BL-RELEASE-READINESS Generator handoff

Implementation/local command evidence only. No self-evaluation, signoff,
release-readiness decision, push, production operation, Secret/environment edit,
or human gate decision is included.

## Frozen source and implementation commits

Source freeze: `55cfe2353da6d1901e82c60f40a9edc944349b9a`.

- F001: `652995d147236d4d881489ebd9309ab99631b1e8`.
- F002: `9a5a0d347c341c6443ee68831043d4de7b3a3dd3`.
- F002 strict-null adjudication transport: `0bbe22ae799850d48cdc1bd131964b7f67f08bd3`
  (Coordinator original `8ff63a7`).
- F002 strict-null revision: `c93d8c1c4f21309a88bb28ba808416dd4524eb69`.
- F003: `55cfe2353da6d1901e82c60f40a9edc944349b9a`.

F004 remains pending: this handoff adds local evidence only. Exact final native
CI results are Coordinator-owned. F005 remains pending independent registered
Kimi-family acceptance. State remains `building`, `release_ready=false`, and
`current_sprint=BL-RELEASE-READINESS` (active feature is only in Generator notes).

The starting candidate is a broad accepted upgrade composition, not a two-file
hotfix. No accepted queue/process source, dependencies/overrides/vendor,
schema/migration, old historical evidence, or old test outside the two approved
fixture adaptations was changed by these features.

## Local commands at the frozen source

Node executable: `/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node`.
Fresh `npm ci` ran in this owned worktree, not a shared `node_modules` tree;
`01-npm-ci.log` contains v22.22.0/npm10.9.4, 670 installed packages and exit0.
It reports 7 high vulnerabilities. No dependency fix/audit closure is claimed.

CLI imports/tests run with short real directories established before imports:
`HOME=USERPROFILE=/private/tmp/tkrg.BIlgHB/h`,
`TMPDIR=/private/tmp/tkrg.BIlgHB/t`. The two directories are deliberately
distinct so the retained real-home launchd refusal assertion remains meaningful.
No `EVAL_*`, real database URL or external fixture directory was inherited;
only `.env.example` exists in this worktree. Build uses an explicit placeholder
`DATABASE_URL`, not a live database.

| Record | Command/result |
| --- | --- |
| 16 | `npm run lint`, exit0 |
| 17 | `npm run verify`, exit0 |
| 18 | `npm run build`, exit0 |
| 19 | DEFAULT `npm run test`, exit0; 168 passed / 13 skipped files, 2005 passed / 34 skipped tests |
| 20 | Focused process/privacy/queue/release/preflight/macOS controls, exit0; 19 passed / 1 skipped files, 185 passed / 6 skipped tests |

The paired JSON files contain argv, timestamps, cwd, synthetic HOME/TMPDIR,
exit/signal/error; logs contain unmodified command output. The default full run
did not add worker, exclusion, deadline, timeout or filter flags. Existing
historical config exclusions and native/database skips are retained, not PASS.
No Windows/Linux CI, PG16, browser or OCI outcome is inferred from these commands.

Earlier feature command evidence: F001 `02`=31/31 and `03` verify0; F002 final
`07`=45/45 and `05` verify0; strict-null `13`=34/34; F003 final `14`=98/98 and
`15` verify0. The macOS installer test uses its own scoped launchd identity and
temporary HOME; this is not installation on a user's actual service, signing,
notarization, or macOS Actions runner acceptance.

## Retained failures and corrections

- `04` failed one newly added predecessor positive: malformed JSON in its curl
  mock. `06` retained the same positive failure after using unsupported `-v`
  on macOS Bash3.2. The mock now uses portable parameter-presence syntax; `07`
  passes. Existing assertions/timeouts were not weakened.
- `08` failed three new preflight controls: Vitest `it.each` spread was mistaken
  for an argument array, the timeout mock did not relay SSH stdin, and valid
  transport reports were refused. `09` retained the corresponding new-test TS
  argument error. The new mocks/table were corrected; `10` retained two remaining
  transport failures and `11` passed typecheck.
- `12` retains the single-control transport diagnostic (other controls skipped
  by its declared `-t` filter). Its sanitized fixture JSON demonstrated a jq
  parameter named `$keys` shadowing the built-in `keys` filter. Renaming the
  parameter to `$expected` preserves strict exact-key filtering; `14` and the
  default full run pass, including unallowlisted stdout/refusal controls.
- `final-provenance.json` and `frozen-input-paths.json` preserve the first
  inventory: the new report checker omitted the spec-approved deploy script
  from its mutable-path list, falsely flagging it. The corrected report helper
  generated separate `final-rerun-*` files; no product/source bytes were changed
  to obtain that result.

## Source/path integrity and approved exceptions

`F001-provenance.json`, `F002-provenance.json`,
`F002-null-code-revision.json`, and `final-rerun-provenance.json` record exact
source commits, paths, SHA256, Git blob IDs, current hashes and exceptions.
`final-rerun-frozen-input-paths.json` compares all 2164 starting tracked blobs:
0 changes outside the declared mutable paths. Dependencies, queue and schema
have additional explicit SHA256 pairs. Files absent at baseline are additive
feature/evidence paths, not overwritten historical artifacts.

- All seven approved F001 source paths equal `3d0a974` byte-for-byte.
  Workflow transport was selective: B06/B07 DB environment/probes and the
  no-skip floor15 remain. macOS is prerequisite for OCI artifacts and deploy.
- F002 deploy script equals `bc9badc` byte-for-byte. The predecessor script
  differs only in the adjudicated missing-code vs explicit-null predicate.
  `F002-null-code-revision.json` links its original/final SHA256 and null negative.
- The two existing fixture changes are exactly the committed adjudications:
  release-rehearsal keeps all old prerequisites and adds macOS; release-image
  imports stronger predecessor fixtures/controls and the two approved assertion
  adaptations, plus explicit rollback-up-after-stop strengthening. All old
  cases and other assertions remain. New negatives live in a new file.
- F003 source/workflow/control hashes are in `final-rerun-provenance.json`.
  Operator usage, output scope, limits and refusal semantics are in
  `operator-preflight.md`. No live inventory was run by this Generator.

`SHA256SUMS` covers the final Generator evidence bundle (excluding itself).
Prior reports/verdicts/receipts and archived state remain immutable.

## Replay and outstanding gates

`run-local.mjs` writes logs/results with `wx`; a repeat must use a new record
name. Recreate its short HOME/TMPDIR directories or copy this evidence helper
to a separate report directory before rerunning. Never overwrite the old logs.
The complete focused argv is in `20-f004-focused.json`.

Coordinator: review/transport exact frozen commits, record exact candidate
Linux/Windows/macOS/PG16/browser/OCI CI independently, then arrange fresh
registered Kimi acceptance. Do not mark F004 complete from local results.
Main-only provenance, real production predecessor/baseline, encrypted off-host
backup/restore, recovery and original homepage F005 remain separate gates.
This predecessor guard is not bootstrap or a general concurrent-deploy lock;
inventory cannot fabricate/establish activation records or authorize cutover.
