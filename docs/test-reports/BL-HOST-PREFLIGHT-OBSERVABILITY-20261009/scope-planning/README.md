# Independent supporting planning scope review

## Outcome

`verdict.json` records `violation=false` for the planning snapshot at
`9db2ebf293f874157ef614af6bf53b4bc91e996d`. The only current change from base
`1f52c86d5e5448ed48959cb1bfe63b6de1d26798` is the supporting spec. No Generator
implementation has been evaluated. This is not functional acceptance, a release
verdict, parent F004/F005 closeout, or authorization to operate the host.
`release_ready=false` remains unchanged.

The review read the rules, frozen spec, script, actual workflow validator, all
existing host-preflight test source, feature ownership and retained original
live refusal independently. Script/workflow/old-test bytes at base equal the
listed product baseline `76d916ba2e3a7147acda5ac9ef15fa70a9cd9958` (empty scoped
`git diff --stat`). No product/test command, GH, SSH or production query was run.

Two non-blocking wording boundaries were sent to Coordinator before code:
new metadata may not emit sensitive values/hashes, but cannot delete or expand
old approved file hashes; supporting source commits must map to existing
`BL-RELEASE-READINESS-F003` without new features or state changes. Coordinator
recorded both in final spec commit `9db2ebf`; the critic independently read that
diff. The critic did not modify the spec.

## Locked implementation constraints

- Only the existing Compose version capture and report serialization may change
  in `scripts/ci/vps-host-preflight.sh`. The shared `query()` function, tool list,
  environment clearing, all non-Compose queries and later inventory branches
  remain byte-frozen. No extra query, subprocess fallback or host write.
- Preserve `timeout --signal=KILL 5s docker compose version --short` and
  `head -c 16385`. Capture the complete pipefail pipeline status, not `query()`'s
  generic return 1 and not a value obtained after `!` masks the status.
- Classification order: retained capture over cap, nonzero pipeline, invalid
  existing semver, valid existing semver. Refusals stay `compose_unavailable`,
  `versions.compose=unknown`, `outcome=refused`, with no later config/app/DB query.
  Successful metadata does not bypass any existing downstream refusal.
- `captured_bytes` counts the retained shell string after stripped trailing
  newlines; it is not total emitted stdout/stderr. Keep it byte-based under local
  multibyte locales without changing global/shared query behavior. No widening
  of the 16384/16385 query cap, 5s query, 150s SSH or 65536-byte report bounds.
- HOME presence is a Boolean variable-presence test. Unset is false; present
  empty or present canary path is true. No value, path, config or existence query.
- Initialize `not_run` and null metrics before any early full-report refusal.
  Preserve the existing missing-jq minimal refusal verbatim: it remains invalid
  as a full transport report. Keep `schema_version=1` and all old report fields.
- Add exactly four `compose_probe` keys: status, pipeline_exit_status,
  captured_bytes, home_present. No raw invalid version/stdout/stderr/environment
  value, hash, internal-cause inference, timeout claim or cleanup claim. Exit
  124/137/141 alone is only a numeric pipeline observation.
- Change only the real workflow jq validator; every byte outside it is frozen,
  including SSH `env -i PATH=/usr/local/bin:/usr/bin:/bin`, production environment,
  human review gate, operation conditions, normal verification, OCI/recovery and
  deployment jobs. New validation must not weaken old acceptance predicates.
- Freeze all existing tests, fixtures, assertions, skips and timeouts. Only add
  `tests/ci/vps-host-preflight-observability.test.ts` and new scoped evidence.
  Product source, dependencies, DB schema, state, rules and original evidence
  remain frozen. Reports must not advance parent feature or release states.

## Required local synthetic evidence, not executed here

The later independent Evaluator must execute every old host-preflight test
unchanged, the actual workflow validator, and additive controls for valid
version, nonzero capture, invalid/canary output, oversized output, bounded hung
Compose query, HOME absent/present/path-canary. Empty HOME is also a direct
presence-contract control. Demonstrate unchanged Compose argv, no mutations or
new queries, and no later query on each Compose refusal. Include collision cases
such as over-cap plus nonzero status, and keep stripped-newline/byte-count
semantics explicit rather than equating captured bytes with emitted bytes.

The validator needs positive full reports with `not_run`, `ok` and every refusal
status; negative controls for missing/extra top-level or metadata keys, wrong
enum/type, fractional/out-of-range metrics, invalid null relationships and
secret-bearing additions. Use the filter from the actual workflow, not an
independently rewritten approximation. Check source byte pins against base for
the entire workflow outside the filter, shared query and non-Compose script
behavior, old tests and canonical state. Preserve initial failures; do not retry
to obtain a green result or reclassify failures as skips.

An exact Generator source SHA is still required for the second scope review.
Fresh Kimi-family supporting evaluation remains separate and mandatory. Local
synthetic acceptance cannot prove live plugin availability, HOME root cause,
backup/recovery, predecessor identity, native Windows readiness or release safety.

## Live evidence limit

The original retained run 37812774615 report contains Docker `29.1.3`, platform
`Linux/x86_64`, `reason=compose_unavailable`, empty `files`, and unknown app,
Postgres and configuration identities. The source makes Compose precede those
queries. The workflow's SSH environment omits HOME. Together these prove the
refusal location and transport environment, not why Docker Compose failed.
No install, HOME restoration, plugin-directory probing or host repair follows.

Workers may not push, use GH/SSH, access credentials/queues or alter Secrets,
environments, config, services or DB. Only Coordinator may publish an exact
reviewed/evaluated safe non-main source and request `operation=host-preflight`
behind actual protected human production review. Normal release jobs must remain
skipped for that operation; main publication and bootstrap are not authorized.

## Evidence pointers

- Frozen final spec: `docs/specs/BL-HOST-PREFLIGHT-OBSERVABILITY-20261009.md:19-91`.
- Baseline capture and Compose branch: `scripts/ci/vps-host-preflight.sh:7-12`,
  `scripts/ci/vps-host-preflight.sh:71-84`; report/early refusals: lines 19-60.
- Actual workflow transport/validator: `.github/workflows/deploy-vps.yml:55-140`.
- Existing test source: `tests/ci/vps-host-preflight.test.ts:1-294`.
- Existing F003 ownership: `features.json`; parent spec
  `docs/specs/BL-RELEASE-READINESS-spec.md:57-76`, lines 103-111.
- Retained original live report:
  `docs/test-reports/BL-RELEASE-READINESS-coordination-20261008/host-preflight-37812774615-artifacts-original/tokenizer-host-preflight-76d916ba2e3a7147acda5ac9ef15fa70a9cd9958/inventory.json`.
- Base blob pins and final spec SHA-256: `verdict.json`.
- Read-path error and corrected lookup: `read-command-notes.txt`.
