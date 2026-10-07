# B03 immutable-evidence follow-up

Follow-up product/test commit: `237094a` (parent handoff `321005a`).

## Correction

- Restored `tests/evaluator/b03-scope-admission-independent.test.ts` to its
  original byte sequence. The historical manifest now verifies all four
  entries, including the restored evaluator test.
- Added one exact Vitest exclusion for that immutable pre-R07 test. It remains
  in the repository as historical evidence, but its intentionally obsolete
  `dryRun:false` rejection is not executed against the operational R07 product.
- Added `tests/cli/replay-operational-contract.test.ts` as the candidate-owned
  successor. It covers the explicit execution plan plus the old one-file,
  source, path, UTC, budget, unknown-option, scope-fingerprint, and widening
  negatives without reading local-only Git objects or historical report data.
- No prior evaluator report, verdict, evidence JSON, or `SHA256SUMS` file was
  edited.

## Verification

- `shasum -a 256 -c docs/test-reports/B03-scope-admission-independent-20261007/evidence/SHA256SUMS`: **4/4 PASS**.
- Node `v22.22.0`, macOS arm64:
  - `npm run verify`: PASS
  - `npm run lint`: PASS
  - `npm test`: PASS, 124 files / 1,614 tests; 9 files / 23 environment-gated tests skipped
  - focused operational replay set: PASS, 4 files / 60 tests
- The replacement regression contains no commit SHA, `git show`, filesystem
  dependency outside its fixtures, or dependence on old evaluator artifacts.

This proves local clean-checkout portability of the test design. A new exact-SHA
safe-branch CI run remains for the independent Evaluator/coordinator; this
Generator did not push a branch or claim CI execution.
