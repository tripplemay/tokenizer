# Exact native CI blocker

Source: `76d916ba2e3a7147acda5ac9ef15fa70a9cd9958`.
Run: https://github.com/tripplemay/tokenizer/actions/runs/37803611472
Windows job: `113401991277`, Node `v22.23.3`.

- Ubuntu, macOS launchd, PostgreSQL16 and authenticated browser: success.
- Windows: 8 failed / 1887 passed / 144 skipped; 6 failed files.
- Linux OCI/recovery and Deploy: skipped, not accepted.
- Root main and production app/database were not changed.

Original unit-failure log SHA256:
`1d6ccd9641c573f1de858ef723e75f59ba662b5c3f80505e6b80cfa0a22fdb4e`.
Run/job metadata and original full-job log are retained beside this report.

Observed failures: new host-preflight workflow-block parser, parent identity
afterRead refusal mismatch, privacy regular-file child admission, combined-output
cleanup error, inherited-pipes timeout expectation, and three aggregate 5000ms
replay test timeouts. The privacy admission is an observed negative-control
failure; precise Windows errno and process/lifetime causes require native probes.
Do not turn a suspected fixture or aggregate-budget issue into a product claim.

Next step is an isolated synthetic diagnostic workflow. Preserve all original
tests/assertions/timeouts and collect the decisive filesystem and child-process
branches before locking repairs. F004/F005 remain pending; release_ready=false.
