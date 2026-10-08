# Generator supporting handoff

This is implementation and development-run evidence, not an Evaluator verdict,
scope acceptance, native signoff, or release approval.

- Supporting task: BL-HOST-PREFLIGHT-OBSERVABILITY-20261009.
- Canonical ownership: BL-RELEASE-READINESS / F003.
- Worktree: /Volumes/ORICO/project/.worktrees/tokenizer-host-preflight-observability-20261009.
- Starting base: a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca.
- Locked spec: 9db2ebf293f874157ef614af6bf53b4bc91e996d.
- Frozen source: cddb822cc2452c2042309de73064a38f0c4224cf.
- Source change: exactly the script, existing host validator, and separate new test.
- Independent post-source scope review and fresh cross-family evaluation: pending
  outside this Generator task. No Generator verdict is provided.
- release_ready=false; native/release/production signoff remains unperformed.

## Implementation pointers

The Compose capture retains the existing timeout/head argv and saves the whole
pipeline status before classification. A retained byte count over 16384 wins
over a nonzero pipeline status. A subshell-local C locale measures bytes of the
shell string after stripped trailing newlines; it does not measure total emitted
stdout/stderr. HOME metadata records only variable presence, including an empty
value. No HOME restoration, plugin discovery, fallback, or added host query exists.

The real workflow filter requires exactly four compose_probe keys and enforces
classification-specific integer, null, enum, and Boolean relationships. All
workflow bytes outside that filter are pinned by the new test. Shared query and
all script bytes outside Compose capture/serialization are independently pinned
against the base by that test. Existing test/state/rule/dependency bytes are pinned.
These are implementation/test descriptions, not independent acceptance findings.

## Actual development command outcomes

All original logs remain in logs/. commands.md records invocation details.

| Run | Exit | Observed output |
| --- | --- | --- |
| Initial Node extraction in /private/tmp | 1 | No space left on device; original tool output truncated |
| Initial requested Node --version | 127 | Missing binary after partial extraction; log 03 |
| Initial npm ci configuration | 1 | /dev/null configured as both user/global config; log 04 |
| Relocated npm ci, original session 85769 | 0 | 670 packages added; log 10; 7 high audit findings reported |
| Old host tests, original session 69174 | 0 | 43 passed, no old-test edits; log 11 |
| New tests, original session 40584 | 1 | 31 passed / 1 failed; log 12 |
| Initial verify | 2 | Four TS2769 errors in the new test env types; log 13 |
| Initial lint | 0 | eslint app src; log 14 |
| New tests after new-fixture correction, session 52265 | 0 | 32 passed; log 15 |
| Verify after new env type correction | 0 | prisma generate + tsc; log 16 |
| git diff --check / bash -n | 0 / 0 | logs 17 / 18 |
| Source commit | 0 | Three source/test files only; logs 19 / 20 |
| Frozen path source diff | 0 | Empty output for protected paths; log 25 |

The new-test failure was not repaired by weakening an assertion: the baseline
fixture lacked HEAD_CODE='', while the candidate fixture had it. Both now run
with the same synthetic settings; the strict redacted-body/argv comparison is
unchanged. The type failure was repaired only by using NodeJS.ProcessEnv with
the required NODE_ENV='test' in the new test's synthetic environments. No old
test, fixture, assertion, timeout, skip, product script, or workflow was changed
in response to those development failures.

## Environment and original evidence boundary

The one newly created initial helper root was /private/tmp/hpog-20261009. It was
moved intact to /Volumes/ORICO/project/.hpog-20261009 after local ENOSPC. No other
temporary/user directory was cleaned or inspected. External HOME, TMPDIR and
npm cache are real canonical synthetic directories (log 24). The archive checksum
matches the downloaded Node 22.22.0 release checksum (logs 07 / 08).

The relocated original npm session used the newly extracted Node 22.22.0 binary.
It was STOP/CONT paused once on Coordinator instruction, not terminated/retried,
and returned exit 0 through its original running session. All subsequent tests,
verify/lint and version checks used the existing explicitly verified runtime:
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin (Node 22.22.0, npm 10.9.4).
No additional npm ci was used to hide the initial configuration failure.

The first tar call was not redirected. Its original tool return reports 865
lines / 48035 tokens and truncation. It is NOT a complete raw stderr artifact;
initial-tool-errors.md preserves that limitation and the returned excerpts.
Do not describe this archive as containing every original byte of that tar call.
Every actual test/verify/lint failure is retained in a complete redirected log.

No real Docker, SSH, GH/API, Secrets, queue, credential-store, push, deployment,
native suite, full suite, DB migration, or production operation was run. Docker
and transport calls in the old/new tests were synthetic fixtures. verify only
generated the local Prisma client and typechecked; it did not connect to a DB.
State, features, pending gates, rules, old reports and auto-memory were not written.

## Handoff artifacts

- generator-handoff.json: schema-shaped implementation manifest, not a verdict.
- development-results.json: exact source identity and command outcomes.
- commands.md: exact development invocation profiles and original failures.
- initial-tool-errors.md: original unredirected tool failure boundary.
- source.diff: generated diff from the starting base to the frozen source.
- SHA256SUMS: generated hashes of the included artifacts/logs.

Only the Coordinator may transport the reviewed/evaluated exact source to an
authorized safe non-main branch. No publication or production operation is
performed or authorized by this handoff.
