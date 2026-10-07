# B03 Generator round2: canonical temporary fixtures

This supplements, rather than rewrites, round1 evidence at
`d86c5810cd0f6b15216425f9a25c324971b1f362` (product `c69ef68`).
Test-only commit: `86aabe9a2297e8621b30d6a5b12a2b15e2777bfa`.
It is not independent acceptance.

Default macOS tmpdir was `/var/folders/...`; `/var` is a symlink to
`/private/var`. The product intentionally rejects a replay source whose literal
path traverses ANY symlink ancestor, including this system alias. Users must
pass the physical `/private/var/...` path, not an alias or a path with dot
traversal. This policy was not relaxed to make tests pass.

Only three candidate-owned fixture factories changed to
`mkdtempSync(join(realpathSync(tmpdir()), prefix))`: replay.test.ts,
replay-safety-regression.test.ts, privacy-admission-cli.test.ts.
Assertions, race hooks, product code and Vitest configuration were unchanged.
This lets hooks actually reach their intended boundary with no task TMPDIR
override; explicit test-created parent symlink/junction attacks still fail.

Node22.22.0, darwin arm64, inherited/default macOS TMPDIR:

- Before: focused 10 failed / 82 passed / 1 skipped, exit1,
  `evidence/default-before.log` (9 files, including CLI help).
- After: focused 92 passed / 1 skipped, exit0, `evidence/focused-default.log`.
- Standard `npm test`: 1622 passed / 24 skipped, exit0,
  `evidence/full-default.log`; verify exit0, `evidence/verify-default.log`.
- Runtime paths: `evidence/runtime-default.json`.

The previously committed round1 report and manifest remain byte-identical;
`evidence/round1-report-unchanged.diff` is empty. Its source/test hashes describe
the OLD candidate at d86c581, not newer HEAD. Do not interpret checking that old
manifest against modified current source as an immutable evidence violation.
All 24 old entries verify against an exact Git archive of that commit:
`evidence/round1-commit-snapshot-hashes.log` (24 OK). Reproduction from a checkout
containing the ancestor object, in a new scratch directory:

```sh
git archive d86c5810cd0f6b15216425f9a25c324971b1f362 $(awk '{print $2}' docs/test-reports/B03-replay-generator-fix-20261008/evidence/SHA256SUMS) docs/test-reports/B03-replay-generator-fix-20261008/evidence/SHA256SUMS | tar -x -C "$SCRATCH"
cd "$SCRATCH"
shasum -a 256 -c docs/test-reports/B03-replay-generator-fix-20261008/evidence/SHA256SUMS
```

No active test depends on those local Git objects. This is an audit reproduction
instruction only. The original a8a4072 pre-review and older independent
manifests were not changed. Later scope fixes and final current-candidate
validation are separately recorded in `B03-replay-scope-safety-20261008`.
