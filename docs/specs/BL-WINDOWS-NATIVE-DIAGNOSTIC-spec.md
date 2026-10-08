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
