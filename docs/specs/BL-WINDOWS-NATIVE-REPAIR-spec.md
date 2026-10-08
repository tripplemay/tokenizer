# BL-WINDOWS-NATIVE-REPAIR

## Scope and evidence

Narrow repairs for confirmed Windows evidence, not a release-signoff shortcut.
Base is cdad05a (report-only successor of source76d916b). Parent release-readiness
state is archived byte-identically; root main/original homepage batch and parent
worktree stay untouched. Parent F004/F005 remain open, release_ready=false.

Original release run37803611472 / Windows job113401991277 failed8 tests.
Supporting diagnostic run37808814119 atf6b89d781a74f7baff4db0d47733e813f04b839c
contains native Node22.23.3/libuv1.51.0 evidence. It is not product acceptance.
Read its original JSON/JSONL/provenance under the sibling diagnostic-ci worktree
docs/test-reports/windows-native-ci-20261008/run-37808814119-original/.
Do not rely on implementation narrative or rewrite earlier evidence.

Confirmed: regular-file child realpath/lstat ENOENT, fallback ancestor regular
file admitted; combined600+600 output invokes taskkill, child closes0 before
taskkill128, worker maps to supervision; workflow checkout821 CRLF and heading
index -1, normalized LF preserves all guards. Exact taskkill128 meaning is not
proved. Parent hooks/three replay timing cases were NOT reached in the supporting
diagnostic because first PowerShell check timed out; their causes remain open.
Inherited-pipes returned356ms, both recorded PIDs dead at return/+100ms. This does
not prove arbitrary descendants cleanup or the automatic job mechanism.

## F001 - Directory-only missing-tail privacy normalization

Modify src/cli/privacy.ts only as needed to reject a missing descendant when its
nearest successfully resolved existing ancestor is not a directory. Keep ordinary
missing tails under a real directory working. Preserve canonical/symlink alias,
fail-closed permission/cycle/broken-link behavior and all identity/path redaction
and queue/wire contracts. Add new event/rule/negative/positive controls. No old
tests or fixtures may change. Do not infer a queue/wire incident from filter-only
evidence, and do not require an otherwise valid direct event path to be a directory.

## F002 - Preserve output reason only on proven completed cleanup

Modify src/cli/bounded-subprocess-worker.mjs narrowly for the observed already-
closed short writer race. Never reinterpret taskkill128 or any nonzero as success
by itself. A failed kill with still-live child, unclosed owned pipes, watchdog or
unknown cleanup must stay supervision failure. Preserve original output/timeout/
launch caps and close/cleanup deadlines on all platforms. No worker architecture,
Job Object platform, global allowance increase, public error hierarchy change or
unconditional error suppression. Retain combined1024 overflow and1200 positive;
add controls distinguishing proven natural exit/closed streams from failed/unknown
cleanup and record what Windows descendant ownership remains unproved. If safe
completed-cleanup proof cannot be implemented narrowly, leave this feature pending
with evidence rather than weakening supervision.

## F003 - Portable new host-preflight workflow fixture

Only tests/ci/vps-host-preflight.test.ts may normalize its in-memory workflow text
for LF/CRLF when extracting job blocks. Fail explicitly on missing headings;
retain every existing guard/needs/no-mutation/assertion. Add LF/CRLF/missing-job
controls in a new test file. Do not edit .gitattributes, actual workflow bytes or
disable any platform. This one test-file exception is explicit; all other existing
tests/assertions/fixtures/timeouts/exclusions remain byte-frozen.

## F004/F005 - Truthful regressions and independent acceptance

Fresh Node22 npmci/lint/verify/build/full/focused with original failure/rerun logs.
Separate scope critic before code and after frozen source. Final exact native CI
must retain any unresolved W02/W03/W05/W06/W08 failure; never increase old test or
global timeout, replace old fixtures or skip cases in this batch. Native/cross-
family acceptance remains pending when those are unproved. Fresh registered Kimi
must independently derive privacy and subprocess/CRLF controls; Generator does
not self-evaluate. A local PASS of F001-F003 is not F004/F005 batch completion or
server/Agent release. Later unresolved repairs need a separate narrow adjudication.

## Allowed paths / boundaries

- F001: src/cli/privacy.ts; new tests/cli/windows-native-repair/privacy*.test.ts.
- F002: src/cli/bounded-subprocess-worker.mjs; new
  tests/cli/windows-native-repair/subprocess*.test.ts and new scoped fixtures under
  tests/fixtures/windows-native-repair/ only. Existing process fixtures frozen.
- F003: tests/ci/vps-host-preflight.test.ts; new
  tests/ci/windows-native-repair-workflow*.test.ts.
- New docs/test-reports/BL-WINDOWS-NATIVE-REPAIR*/ artifacts; this spec,
  archived parent state, progress.json/features.json.

All other tracked bytes/modes, dependencies/lock/vendor/schema/migrations,
accepted queue/replay/Git/version/service bytes and old reports remain frozen.
Commit each implementation feature separately with batch feature tag. Workers
never push, deploy, operate SSH/Secrets/environments or write human decisions.
User's push/deploy authorization belongs only to Coordinator after gates; this
batch neither changes production nor authorizes main publication.
