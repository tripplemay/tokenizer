# Exact-source supporting scope review: cddb822

## Outcome

`verdict.json` records `violation=false` for exact Generator source
`cddb822cc2452c2042309de73064a38f0c4224cf`, against planning base
`a5ea6e3f66ab4b4b831de88a6bcb078f444b2aca` and original base
`1f52c86d5e5448ed48959cb1bfe63b6de1d26798`, under final spec `9db2ebf`.
No scope blocker was observed. Any product change requires a new exact-ref
review; this conclusion cannot be transferred to a different source.

This is a scope-critic report, not functional Evaluator acceptance. No feature
or release PASS is issued. `release_ready=false` remains byte-frozen. Fresh
Kimi-family supporting evaluation and parent release/native/recovery/predecessor
gates are not closed here. Generator-reported development results were not used
as evidence.

## Independently established boundaries

- `git diff --name-status a5ea6e3..cddb822` lists exactly the allowed script,
  workflow and new test. Original-base diff adds only previously reviewed spec
  and planning artifacts beyond those three source files.
- Six independent static controls normalize only the explicit metadata
  initialization/serialization and Compose capture. The resulting entire script
  exactly equals both bases. Shared `query()`, non-Compose queries, environment
  clearing, old inventory/read/hash behavior and missing-jq minimal report are
  unchanged bytes, not merely similar behavior.
- Every workflow byte outside its real jq filter is identical to both bases.
  Removing only the new helper, root key and metadata predicate restores the
  entire old filter. SSH environment/argv, protected production review boundary,
  transport/report limits and release job conditions remain unchanged.
- Old preflight test and protected product/state/dependency/schema/rule/memory
  paths have empty diffs. New tests were inspected, not run by this critic.
- Compose capture keeps the original timeout/head/command argv. The assignment
  records pipeline status before other operations, then checks retained byte cap,
  nonzero capture and existing semver in that order. No new host query or fallback.
- HOME presence is shell presence only. Byte count is in a Compose-local C-locale
  subshell; it does not change shared query or child command environment. Neither
  number is a total emitted-output, timeout-cause or plugin-discovery statement.
- The report keeps schema version 1 and adds only the fixed four metadata keys.
  Old file metadata hashes are neither removed nor expanded. Invalid output and
  HOME path canaries do not enter the report or stderr.
- The commit tag maps to actual existing `BL-RELEASE-READINESS-F003`; no canonical
  feature/status or human gate decision changes. The supporting name is not a new
  feature and does not reopen or accept F003.

## Independent narrow controls and retained first failure

`controls-initial.mjs` is the original driver; `controls-initial.log` is its first
raw output (exit 1). Six static byte controls completed, then the first HOME
scenario observed `not_run`/null metrics rather than expected `ok`. The driver
had created a deploy fixture under `/tmp`; the independent `ls -ld` output was:

```text
lrwxr-xr-x@ 1 root wheel 11 Aug 13 09:51 /tmp -> private/tmp
```

The unchanged script requires the physical deploy path to equal the argument.
This identifies an own-fixture alias mismatch, not permission to remove the
old path guard. The corrected driver `controls.mjs` changes only the `node:fs`
import and newly created fixture-root canonicalization to `realpathSync`.
No assertion, product source, timeout or cap was changed. Its first execution
has separate output `controls-realpath-fixture.log` (exit 0); the original
source/log remain intact. This is a changed-fixture experiment, not a claim
that the original failed run passed or an unchanged acceptance retry to green.

The corrected-fixture log contains 29 narrow controls:

- Six byte/protected-path controls across both bases.
- HOME unset/empty/canary path, pre-Compose not_run/null metrics, numeric pipeline
  7/124/137/141/255, and rightmost head failure 141 versus Docker 7.
- Invalid/canary output, over-cap precedence for zero/nonzero pipeline, stripped
  newlines and truncated UTF-8 retained byte count. Every Compose refusal stopped
  before later file/config/app/DB queries; tool argv and fixture hashes were checked.
- One synthetic 5s hung query completed refusal in 5485 ms with numeric 124.
  Timeout/head are controlled local fixtures: this is not real-host or owned-tree
  termination evidence.
- The actual workflow jq filter accepted all five typed metadata classifications
  and rejected 41 malformed/missing/extra/type/range/null controls plus three
  secret-bearing report additions.

The driver reads the exact source from git objects rather than Generator reports
or working files. Tiny temporary fixtures were removed in `finally`. Local runtime
was Node.js v25.7.0; these are not the required Node22 release regressions. No old
or new Vitest suite, lint, verify, build, native CI, GH, SSH, credential access or
production operation was performed by the critic.

## Reproduction and source pin

From this repository, run the corrected fixture explicitly and retain a new log:

```sh
node docs/test-reports/BL-HOST-PREFLIGHT-OBSERVABILITY-20261009/scope-source-cddb822/controls.mjs
```

The unmodified original experiment is separately replayable via
`controls-initial.mjs`; on macOS with `/tmp` as the same symlink, it intentionally
retains the original alias-path failure. Do not overwrite either historical log.

`verdict.json` pins exact source blobs and all control/log SHA-256 hashes. A final
`git diff --name-only cddb822 --` for script, workflow, new/old tests, state and
supporting spec was empty, so current source files matched the reviewed source
while unrelated report writers were active. Only this critic's report directory
is staged and committed.

Run 37812774615 still proves only the original compose_unavailable refusal
location, not a HOME/plugin root cause. This task does not authorize an install,
environment repair, service/config/DB change, main push or bootstrap. Only
Coordinator can publish the exact reviewed/evaluated non-main source and request
protected human-reviewed `operation=host-preflight`; the frozen release jobs stay
excluded for that operation.
