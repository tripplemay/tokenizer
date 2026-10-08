# Native Windows diagnostic transport

Supporting implementation only, not an evaluator verdict or release gate.
The failed release baseline remains
`76d916ba2e3a7147acda5ac9ef15fa70a9cd9958`.
No native Windows execution has occurred in this worktree.

## Scope and transport

- Added only `.github/workflows/windows-release-diagnostics.yml` and this report
  directory. No product, dependency, old tests, fixtures, release workflow,
  `progress.json`, or `features.json` changes.
- The new workflow has only manual dispatch and an exact-branch push trigger for
  `codex/windows-native-diagnostic-ci-20261008`. Its job separately requires that
  exact branch ref; no PR, main, tag, or glob trigger is present.
- `contents: read`, credential persistence disabled, no Secrets or environment,
  no remote host or deployment operation, isolated concurrency, 12-minute job.
- Native `windows-latest`, Node 22, immutable `${{ github.sha }}` checkout and
  fresh `npm ci`. Provenance records only SHA, UTC time, OS, Node/libuv and Git.
- Calls the separately committed diagnostic script with its unchanged CLI and
  no arguments. Its existing subprocess/output limits are not modified.
  A diagnostic nonzero remains a failed step and job; it is also recorded in
  `diagnostic-result.json` before returning the same exit code.
- Artifact upload runs with `always()`. Its four explicit allowlisted paths are
  the minimal provenance/result JSON and `native-output-*/*.json` / `*.jsonl`
  under the diagnostician's report directory. No raw temporary trees, profiles,
  credentials, source event files, or environment dumps are uploaded.

## Initial attempt and adjudicated rerun

The initial manual-only workflow passed local syntax and structure checks, but
that did not establish GitHub dispatchability. GitHub documents a default-branch
prerequisite for a newly registered `workflow_dispatch` workflow. The Coordinator
therefore committed the narrowly scoped exact-branch push exception in spec
`d6200799c643d41e2d681bd368ef3e8425657e8f`; no main publication is required or
authorized here. [GitHub workflow_dispatch documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

The original `actionlint-initial.log` and `static-scope.json` are retained without
overwriting them. The revised workflow has separate
`actionlint-adjudication-rerun.log` and
`static-scope-adjudication-rerun.json` evidence.
Neither set contains native Windows results.

## Local commands and boundaries

- `/opt/homebrew/bin/actionlint .github/workflows/windows-release-diagnostics.yml`
  returned 0 both before and after adjudication, with actionlint 1.7.12 on
  darwin/arm64.
- Ruby `YAML.safe_load` plus exact structure/string assertions returned 0;
  resulting booleans and inspected workflow SHA-256 are in the separate JSON
  reports. These are implementation-side static checks, not acceptance.
- Node 22.22.0 `--check` returned 0 for the unchanged transported
  `native-diagnostics.mjs` and `trace-preload.mjs`; no script or probe was run.
- `git diff --check` and staged path/protected-tree checks are recorded in
  `scope-provenance.json`. PowerShell is not locally available.

The Coordinator transported diagnostic source commit
`ec7b439893f4e2c1d0b6de8b1943f1a38860e70b` unchanged as
`e0733ea7855c0814908c9ed5094f3bf1168273db` before this implementation commit.
The inspected path/hash manifest is in `transport-report.json`.

## Pending

The worker has not pushed any branch, changed canonical state, invoked GitHub
execution APIs, or operated a production host. Coordinator review, exact-branch
publication and native execution/artifact capture remain pending. Diagnostic
observations must inform a separately scoped repair and independent acceptance;
neither this transport nor a diagnostic success means release readiness.
