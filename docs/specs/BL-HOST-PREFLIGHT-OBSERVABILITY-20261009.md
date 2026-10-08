# BL-HOST-PREFLIGHT-OBSERVABILITY (supporting diagnosis only)

## Scope and evidence

This section 1.5 supporting task does not replace the active release batch or
change progress.json/features.json. The Coordinator uses the null-binding
Planner compatibility path. Product changes require an isolated Generator,
pre/post scope review and a fresh Kimi-family supporting Evaluator.

Base: 1f52c86d5e5448ed48959cb1bfe63b6de1d26798. Product/script/workflow baseline:
76d916ba2e3a7147acda5ac9ef15fa70a9cd9958.

Approved run 37812774615 returned a valid redacted refusal at compose_unavailable:
Docker server 29.1.3, Linux/x86_64, before any configuration/app/DB identity
checks. The SSH command uses env -i without HOME. This does not prove that HOME
or plugin discovery caused the refusal. Do not install or repair anything on
the host based on this hypothesis.

## Allowed edits

- scripts/ci/vps-host-preflight.sh: fixed redacted metadata for the existing
  Compose version query and report serialization only.
- .github/workflows/deploy-vps.yml: extend only the existing host-preflight jq
  report validator with exact metadata keys/types/enums. Every byte outside
  that validator is frozen, including all release jobs and SSH invocation.
- New tests/ci/vps-host-preflight-observability.test.ts, this spec and new
  docs/test-reports/BL-HOST-PREFLIGHT-OBSERVABILITY-20261009/ artifacts.

All existing tests/fixtures/assertions/skips/timeouts, product source, dependencies,
DB schema, canonical batch state, rules, credentials and previous evidence are
frozen. The shared query() implementation and all non-Compose queries are frozen.
Workers must not push, use GH production APIs/SSH, alter Secrets/environments,
install host tools, or access production/user queues and credential stores.

## Fixed report contract

Keep schema_version=1 and all old outcome/reason/fields and acceptance rules.
Add a required compose_probe object to full reports with exactly:

- status: not_run, ok, command_failed, invalid_version, output_bound_exceeded.
- pipeline_exit_status: null before execution, otherwise an integer 0..255
  representing the existing bounded capture pipeline's exit status. Name and
  documentation must not pretend this is necessarily Docker's own exit code.
- captured_bytes: null before execution, otherwise an integer 0..16385 for
  the bounded captured shell string, excluding stripped trailing newlines.
  Never claim this measures total stdout or stderr emitted by the command.
- home_present: Boolean presence of the HOME variable, not its value, path,
  existence/accessibility, emptiness, or whether any Docker config was read.

The existing missing-jq minimal refusal remains unchanged and is not a valid
full transport report. Before the Compose query status is not_run with null
metrics. On valid semver and successful capture it is ok. Nonzero capture fails
closed as command_failed unless the existing output cap is exceeded; successful
capture with an invalid semver is invalid_version. An exceeded cap has status
output_bound_exceeded. Every such refusal retains reason=compose_unavailable,
versions.compose=unknown, outcome=refused and stops at the same branch.

Exit 124/137/141 is recorded as a number, not proof of a timeout, owned-tree
cleanup, a missing plugin, or a particular internal cause. No timeout inference
or fallback-success behavior is allowed. The existing 5s/16384-byte query bound,
16385-byte cap detector, 150s SSH/65536-byte report bounds stay unchanged.

No raw invalid version text, stdout/stderr, HOME/path/config contents, secret
values/hashes or additional environment fields may be emitted. Do not restore
HOME, inherit environment, query plugin directories, invoke fallback binaries,
change Docker context/config, add host queries or perform host writes.

## Acceptance and publication

Preserve and execute every existing host-preflight test unchanged. Add synthetic
controls for valid version, command failure, invalid/canary output, oversized
output, bounded hung query, unset HOME and set HOME with a path canary; prove
unchanged query argv, no added/mutation queries and no later queries on refusal.
Exercise the real workflow validator: reject missing/extra metadata keys, bad
status/type/range/null metrics and secret-bearing report additions. Pin the
unchanged workflow body outside the validator and shared/non-Compose script
behavior against the base. Do not weaken failures or use retries to green.

Supporting acceptance is local/synthetic only, not parent F004/F005, native
Windows acceptance, backup/recovery, predecessor identity, or release signoff.
release_ready remains false. All raw initial failures must be retained.

Only the Coordinator may publish an exact reviewed/evaluated commit to a safe
non-main branch and dispatch operation=host-preflight. The new run must still
require actual protected human production review. All normal verification,
OCI/recovery and Deploy jobs must be skipped for that operation. No main push,
service/config/DB mutation, installation or bootstrap is authorized by this task.
