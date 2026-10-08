# Supporting native Windows diagnosis

Supporting task under harness section1.5; canonical release progress/features
remain untouched. Baseline is exact failed76d916ba2e3a7147acda5ac9ef15fa70a9cd9958.
This is diagnostic transport, not a repair, evaluator verdict or release gate.

Generator may add only `.github/workflows/windows-release-diagnostics.yml` and
new documentation under `docs/test-reports/windows-native-ci-20261008/`.
Coordinator will separately transport the committed read-only diagnostician's
`docs/test-reports/windows-release-diagnosis-20261008/` tree unchanged.
No product, dependency, old tests, fixtures, deploy-vps workflow or state edits.
Worker never pushes, calls production/SSH/Secrets/environment APIs or deploys.

Workflow requirements:

- `workflow_dispatch` plus a push trigger restricted to the single exact branch
  `codex/windows-native-diagnostic-ci-20261008`; no PR/main/glob trigger. A job
  `if` must also require `refs/heads/codex/windows-native-diagnostic-ci-20261008`.
  No production environment, contents read only, no Secrets or remote targets,
  isolated concurrency group.
- Native windows-latest / setup-node22, immutable commit checkout, fresh npm ci;
  do not install/change any user service. Record actual HEAD, OS, Node/libuv and
  Git versions. Invoke the reviewed Node synthetic diagnostic script using its
  existing CLI, not old tests with changed timeouts/skips.
- Job timeout 12 minutes; diagnostic subprocess and output bounds remain as
  authored. Upload only explicitly named diagnostic native-output JSON/JSONL and
  minimal provenance, never env dumps, profiles, sessions, npm credentials,
  raw source event files or unrelated temp trees. Upload on failure as well.
- Diagnostic findings (including nonzero) cannot weaken existing release needs
  or assertions. The workflow must remain on the non-main diagnostic branch and
  must not be integrated into the release candidate merely to make gates green.

Acceptance here is workflow syntax/scope transport. The observed native runtime
then determines a separately committed narrow repair scope and independent
cross-family acceptance. No diagnostic success implies production readiness.

## Transport adjudication

GitHub's documented workflow_dispatch default-branch requirement prevents a
new manual-only workflow from being the dependable transport on this branch.
Do not publish main to register it. The narrowly approved exact-branch push
trigger above is only for this synthetic diagnostic branch, never a relaxation
of release gates. Source: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch

## Second diagnostic: bounded runtime parity, not a product repair

Original run37808814119 and all32 raw files are preserved under the committed
native-findings-r1/original tree. It confirmed privacy and CRLF failures but did
not reach replay parent hooks or downstream confirmation/admission controls.
Strict synthetic env timed out the first PowerShell check; do not infer an old
test's rename or aggregate-timeout cause from those unreachable branches.

Approve the committed native-findings-r1/runtime-parity-plan.json except its
optionalCombinedArm: no combined env arm in this pass. Generator may add only
docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs
and new parity-report/check artifacts under that same directory. Existing
native-diagnostics, trace-preload, old reports/product/tests remain immutable.
Second CI invokes the new parity CLI instead of repeating the original seven
cases; only that explicit command and corresponding step label/metadata may
change in the dedicated diagnostic workflow. Retain all original scope logs.

E0 stripped env versus E1 SystemDrive from allowed SystemRoot, E2 synthetic
APPDATA, E3 synthetic LOCALAPPDATA, E4 machine-only PSModulePath. Change exactly
one key per env arm, never inherit all runner env or personal module paths.
Cross with preload off/on. Fixed marker then ConvertFrom-Json then owned native
attribute smoke, previous success required. Only one explicitly selected P2-
successful arm per instrumentation form may admit downstream parent hooks and
confirmation/binding/healthy analogs; unreachable stays reported unreachable.
No raw env values/stderr/content; only allowlisted metadata and canary booleans.
No production, Secrets, profile, credential or network access. Existing user
services and unrelated processes are untouched.

Enforce total600s deadline, 40s owned-case watchdog, <=38 smoke / <=76 total
PowerShell launches, existing 10s product budget and output/trace caps. Do not
start work that lacks remaining cleanup/output allowance. Unknown cleanup and
trace health are distinct fail-closed findings, not proof of product cleanup
failure. Always upload only native-output-* JSON/JSONL and minimum provenance.
Scope critic must review the committed new script/workflow before the next
authorized non-main push. Never merge diagnostic workflow into release/main.

### Counter/lifetime guard clarification

The new CLI may self-preload the minimum common launch-budget/owned-lifetime
guard needed to enforce these bounds inside product subprocess workers. This
guard applies to both old-trace off/on arms, has no stream data observer, cannot
swallow error events or replace normal native return values/exceptions, and
reports its own budget abort as diagnostic-not-reached rather than product
failure. No full-runner env inheritance or new code path outside this single CLI.
Report "old trace off / common guard on", never "uninstrumented original CI".
Admit cases only with worst-case remaining launch/time/cleanup allowances;
budget exhaustion is explicit unknown, not permission to raise38/76 or600s.
Prioritize both forms' parent gate before fairly admitting remaining analogs;
complete analog coverage is not required for this supporting diagnostic.
