# B06 report-probe TypeScript boundary: Generator evidence

Base: `6d0842ca1bb06a8a8463738bf837db606bd2850c` (detached worktree). This is a narrow build-boundary change, not a re-evaluation of B06 behavior. No historical Kimi/evaluator or client pre-review report or probe was edited.

## Reproduction and change

Fresh Node `v22.22.0` dependencies: `npm ci --no-audit --no-fund`. Before the change, `npm run verify` exited 2 with 18 TypeScript errors, all rooted in `docs/test-reports/B06-client-prereview-20261008/*.probe.ts`. The diagnostics included TS5097 for explicit `.ts` import specifiers, TS2307 for a historical candidate-only module, and TS2322/TS2339/TS2554 for candidate-specific types. There were no `src/`, `app/`, or `tests/` diagnostics in that baseline run.

`tsconfig.json` now excludes only `docs/test-reports/**` from implicit TypeScript root discovery. It does not change compiler options, application includes, Vitest discovery, or execution of an explicitly selected report test. `tests/ci/tsconfig-report-boundary.test.ts` checks the parsed TypeScript root list: report `.ts` files exist but are absent; representative `src/`, `app/`, and `tests/` files remain present.

## Checks on the changed tree

| Check | Result |
| --- | --- |
| `npm run verify` | PASS, exit 0 |
| `npx vitest run tests/ci/tsconfig-report-boundary.test.ts` | PASS, 1/1 |
| `npm test` | PASS, 1776 passed / 26 skipped |
| `npm run lint` | PASS, exit 0 |
| `npx vitest run --config docs/test-reports/B06-tsconfig-report-boundary-generator-20261008/vitest-explicit-report.config.ts` | PASS, 111/111 in the existing, unmodified Kimi `independent-adversarial.test.ts` |

Negative control: temporary `.ts` files under `src/cli/`, `app/api/`, and `tests/ci/` each contained `const value: string = 123;`. `npm run typecheck` exited 2 with exactly three TS2322 diagnostics, one at each path. Those temporary files were then deleted; `npm run verify` passed again. Thus the exclusion does not mask ordinary source, route, or test type errors.

The explicit Vitest config in this report directory is new. It selects the existing Kimi evaluator file without changing that file or the default test config. Its success demonstrates that excluding report files from application typechecking does not prohibit explicit probe execution.

## Boundary

This is a local native macOS/Node 22 verification, not a fresh remote CI result or product release approval. The exclusion affects only implicit root discovery: if application code later imports a report script, TypeScript can still follow that import. Historical candidate-only client probes were deliberately preserved, not made compatible with this integration tree.
