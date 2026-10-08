# BL-RELEASE-READINESS: exact candidate and safe operator preflight

## Goal and authorization

The user transferred coordination and explicitly authorized the Coordinator to
push main and deploy only after release gates pass. This overrides the external
Codex no-push restriction for that authorized coordination; dispatched workers
must never push. Non-main CI publication, maintenance timing and encrypted
off-host backup remain unanswered at planning. A subsequent user reply authorized
non-main CI publication and maintenance now; encrypted backup target remains
unanswered. Never write pending_gate.decision.

This batch prepares the accepted candidate for release. It does NOT perform a
legacy baseline switch, mutate production, rotate passwords, create an Agent
release or close original BL-HOMEPAGE-FRESHNESS F005. B08 CAS, mutable OpenCode
cursor and new capabilities remain separate. Do not call this the full upgrade.

## Frozen inputs

- Candidate baseline: f700b9ae94c0663a6b7a6fb59acec244ea2b8659.
- Accepted queue implementation: 27d9664e37a659ad28962bee224d871378e4336c.
- Accepted process bounds candidate: 3130cef3bc55528290c49ee35267e1aff33b5c78.
- Other integration: d8b4d7d6d5d5ed84165ea938a83b72d602cad9ab.
- B04 source commits: d0cc44e, 6360404, 13f6ae6, 3d0a974.
- B05 proposed guard: bc9badc8c9c62aaaa2b4aa92ab40d7bc37ee9ed6.

Prior state archived unchanged in docs/archive/process-bounds-closeout-20261008/.
Freeze historical reports/tests/assertions/fixtures, dependencies/overrides/vendor,
schema/migrations. Do not merge the older integration wholesale: it lacks the
accepted queue/process changes. Candidate is a broad existing upgrade composition;
record true scope, not a two-file hotfix. Root main's active batch remains untouched.

At 2026-10-08T04:24Z remote main was 2074991; public health reported 92d410c;
POSTGRES_PASSWORD Secret was absent and production protection_rules was empty.
Default SSH to the documented VPS was denied. These are blockers, not permission
to search personal credentials. User inputs and live evidence override snapshots.

## F001 - Compose macOS native gate without replacing accepted slices

Transport B04 macOS launchd code, portable fixture/trap tests and bounded service
cleanup from the listed commits. Keep B06/B07 PG16 env/probes/no-skip floor, all
accepted process/queue bytes and every other release prerequisite. Add macOS to
release-artifact/deploy needs. Resolve conflicts explicitly, record source SHA/path
hashes; run focused tests/typecheck. No signed/notarized distribution or actual user
service installation claim.

## F002 - Fail closed before deployment mutations

Transport bc9badc's live/retained predecessor guard and regression controls. Before
rsync, .env replacement or candidate manifest creation require one serving app,
exact Compose project/service, 127.0.0.1:3010 binding, activated old digest/config/
SHA ledger and backend readiness. Reject absent/legacy/mismatched predecessors and
stale retry records. Never fabricate activation records. Preserve old assertions;
add separate negative controls if imported tests conflict. This is not bootstrap
or a general concurrent-deployment lock; report those limits.

## F003 - Read-only host inventory via existing Actions SSH identity

Add workflow_dispatch input operation: release (default) or host-preflight.
Host-preflight executes ONLY a non-deploying inventory job using existing VPS
connection Secrets. No builds, rsync/scp, registry login/pull, backups/migrations,
configuration writes or service changes. Normal release jobs run on push/PR or
dispatch release; host-preflight can never enter deploy, including on main.

Send reviewed scripts/ci/vps-host-preflight.sh over SSH stdin. Validate configured
deployment path/host/user/port before interpolation. Fixed project scope only;
no source .env. Query allowlisted Docker/Compose versions, platform/free-space,
tokenizer app/postgres IDs/status/project/network/volume, image revision/UID,
selected GIT_COMMIT/APP_IMAGE/MIGRATE_IMAGE/APP_HOST_PORT nonsecret fields,
backend readiness and existing config/ledger hashes/modes. No raw .env,
Config.Env, DB rows, session data, credentials or personal paths. Explicit
unknown/legacy markers; absent/unhealthy/wrong serving app fails closed.

Bound remote queries; no signals to user services. Upload allowlisted redacted
inventory only, including source SHA and timestamp. Failed stderr must not expose
secrets. Add synthetic fixtures for legacy/digest positives, missing/wrong app,
duplicate settings, malicious arguments/env canaries, timeouts, no mutation
invocations, no raw secret/config output, operation separation and preserved
normal gates. This only inventories; it must not establish a baseline ledger.

## F004 - Local regressions and exact native CI

Fresh Node22 install/lint/verify/build/full/focused tests and immutable logs.
Retain initial failures/skips, no hidden retries, no timeout/exclusion weakening.
Publish native CI only after separate authorization. If blocked leave F004 pending:
local checks do not replace exact final Linux/Windows/macOS/PG16/browser/OCI jobs.
Main-only provenance and real production recovery remain later gates.

## F005 - Fresh cross-family exact-candidate acceptance

Registered Kimi, fresh detached candidate; derive independent pre-mutation,
no-secret/no-mutation probes from actual workflow/scripts, not Generator narrative.
Original verdict/raw evidence immutable. Individual local features may PASS but
unproved F004 CI and release gates remain WAIT/FAIL. No done without all features.

## Allowed paths and role boundaries

- F001: .github/workflows/deploy-vps.yml, src/cli/service.ts,
  scripts/ci/assert-macos-launchd-installer.mjs, additive B04 macOS tests and
  unchanged imported source evidence. Accepted product except service is frozen.
- F002: same workflow, scripts/deploy-vps-release.sh,
  scripts/verify-vps-predecessor.sh, additive/imported release-image controls.
- F003: same workflow, scripts/ci/vps-host-preflight.sh, additive
  tests/ci/vps-host-preflight*.test.ts, operator preflight docs.
- F004/F005: new docs/test-reports/BL-RELEASE-READINESS* artifacts/tests,
  docs/specs, archived state, progress.json/features.json.

Commit each feature as feat(BL-RELEASE-READINESS-Fnnn). Isolated Generator,
read-only scope critic, registered fresh Kimi Evaluator. Workers never push,
deploy, modify Secrets/environments or human decisions. Coordinator transports
exact reviewed diffs, records human authorization and preserves originals.

## Coordinator scope adjudication before implementation

Read-only critic identified old fixture incompatibility with stronger gates.
Only two existing test files have narrowly authorized adaptations:
tests/server/release-rehearsal.test.ts adds verify-macos-agent to its exact
deploy needs expectation, retaining every previous prerequisite/assertion.
tests/server/release-image.test.ts may use bc9badc's fixture additions and new
controls, and its two existing assertion adaptations: immutable digest rejection
message becomes 'immutable candidate manifest differs'; containment ordering
compares stop app against the last --env-file (rollback), since preflight now
also uses --env-file. Retain all old test cases and other behavioral assertions.
Strengthen the latter with an explicit rollback up-after-stop assertion if needed.
Original bytes are archived in BL-RELEASE-READINESS-inputs-20261008/. No other
old test/evidence changes authorized.

Reject 'legacy predecessor' means reject a source-built/non-digest image or a
missing activation/config ledger. Old health format without code is acceptable
ONLY with ok=true, exact activated SHA, exact image/config/project/service/port
evidence; if code exists it must be ready. This permits the separately reviewed
same-old-source baseline, not fabricated legacy provenance. Candidate activation
continues to require code=ready. Retain a negative control for wrong health code.

Exact imported F001 paths: src/cli/service.ts,
scripts/ci/assert-macos-launchd-installer.mjs,
tests/ci/macos-launchd-cleanup-trap.test.ts,
tests/ci/macos-launchd-installer-gate.test.ts,
tests/cli/agent-release-installer-macos.test.ts,
tests/cli/service-launchd.test.ts, tests/server/release-rehearsal.test.ts.
Source is 3d0a974f4916c911917e1b09811c98d5c96b1ec0 (the final composed B04 bytes);
workflow patch must be selective to retain newer B06/B07 gates. F002 source is
bc9badc8c9c62aaaa2b4aa92ab40d7bc37ee9ed6 for scripts/verify-vps-predecessor.sh,
scripts/deploy-vps-release.sh and tests/server/release-image.test.ts, with only
the declared additive stricter controls. F003 docs path is
docs/test-reports/BL-RELEASE-READINESS-generator-20261008/operator-preflight.md.
Provenance/hash inventory belongs under that same Generator report directory.

### Explicit null health code adjudication

The imported bc9 predicate uses .code==null, which admits explicit null as well
as an absent field. The locked wording is intentionally stricter: only a truly
absent code field is old-format compatible; if present, code must equal ready.
Approve exactly this one predicate change in scripts/verify-vps-predecessor.sh:
((has("code") | not) or .code == "ready"), retaining ok=true and exact SHA.
Use the same rule in F003 inventory. Add explicit-null negative controls in new
tests; do not alter any existing health assertion. This narrow F002 source-byte
exception supersedes exact bc9 transport for that predicate only; retain source
and resulting hashes, tagged F002 revision commit and raw failed/rerun evidence.
