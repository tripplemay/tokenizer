# B02 braces internal backport - Generator handoff

Date: 2026-10-08  
Role: Generator; this document is not an independent security verdict or release acceptance.  
Base: `17b47a8e9128eef1f982afa2f5a3257ec72737d3`

## Outcome

A repository-local backport candidate for `braces@3.0.3` is implemented and
reproducibly installed through:

```json
"devDependencies": { "braces": "file:vendor/braces" },
"overrides": { "braces": "$braces" }
```

The exact upstream npm tarball is vendored with its MIT license. The local
patch applies a mandatory depth guard to parser brace/parenthesis nesting and
to direct AST traversal in `compile`, `expand`, and `stringify`. It does not use
a remote Git dependency or the previously disproved parser-only fork.

This is an **internal, unofficial candidate**. Upstream PR
[`micromatch/braces#78`](https://github.com/micromatch/braces/pull/78) was open
and unmerged when captured. No claim is made that upstream has accepted or
published this approach.

## Proven behavior

The committed probe was executed with Node `v22.22.0` and a 512 KiB stack
against both the exact pristine tarball and the patched package.

- Pristine deep string operations `default`, `compile`, `expand`, and
  `stringify` fail with `RangeError: Maximum call stack size exceeded`.
- Pristine direct AST `compile`, `expand`, and `stringify` fail with the same
  `RangeError`. The pristine parser itself accepts the 4000-container string;
  the crash occurs in recursive downstream walkers.
- Patched string/default/parser and all three direct AST walkers accept depth
  100 and reject depth 101 and 4000 with controlled `SyntaxError`, code
  `ERR_BRACES_MAX_DEPTH`.
- Quoted, escaped, and bracket-class brace characters do not consume nesting
  budget.
- Seven representative alternatives, ranges, escapes, nested braces, parsed
  AST, and Tailwind-style glob cases are byte-for-byte equal between pristine
  and patched implementations.

The local walker rule counts only recursive container nodes (objects with a
`nodes` array). This deliberately makes the public boundary unambiguous:
exactly 100 containers pass and 101 fail. The current PR #78 draft counts every
recursive call, including terminal leaves, so its edge behavior differs.

## Source provenance and replay

- npm tarball SHA-256:
  `1cd18e862c8640b4568b1425a7df4ee030ff201d45b2da8f9f222d2987494ffc`
- npm integrity:
  `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`
- captured PR head: `97308a01d091b211cf015314a2d0696da28a5392`
- normalized local patch SHA-256:
  `c869abad619e5428422136751634b425786425131a6694130254fd482cd2a303`
- replay: fresh tarball hash verification, `patch -p1`, then byte comparison of
  all seven modified runtime/metadata files passed.
- `npm ci` resolves `require.resolve("braces")` to checked-in
  `vendor/braces/index.js`; the lockfile contains no Git/codeload source.

`vendor/braces/PATCH-MANIFEST.json` and `TOKENIZER-BACKPORT.md` are the
self-contained source manifest and maintenance boundary. Removing upstream
development-only dependencies from the linked package metadata is also in the
normalized patch; otherwise npm installs braces' obsolete Mocha/Gulp toolchain
for a repository-local linked dependency.

## Validation completed

All commands used Node `v22.22.0` on macOS arm64 unless stated otherwise.

| Check | Result |
|---|---|
| clean `npm ci` | PASS; 670 packages installed |
| focused backport tests | PASS, 10/10 |
| full Vitest | PASS, 1612 passed / 23 skipped |
| `npm run verify` | PASS |
| `npm run lint` | PASS, `--max-warnings=0` unchanged |
| `npm run build` | PASS, Next 16.4.0 |
| emitted CSS vs base `17b47a8` | byte-identical two-file SHA-256 multiset |
| PostgreSQL 16.13 CI-equivalent five-file probe | PASS, 48/48, zero skipped |
| authenticated production-server Chromium journeys | PASS, 3/3 |

The scratch PostgreSQL roles/databases were explicitly set to UTC to reproduce
the CI contract; no production database or configuration was changed. The
cluster was stopped after validation.

## Audit and release boundary

Online audit remains intentionally transparent:

- `npm audit`: **7 High**, all the registry advisory fan-out rooted at
  `braces@3.0.3` through Tailwind/micromatch/chokidar/fast-glob/Next ESLint.
- `npm audit --omit=dev`: **0 vulnerabilities**.

The package retains version `3.0.3`, and npm's advisory service does not inspect
the local source patch. Therefore audit remaining nonzero does not disprove the
code change, and audit becoming zero under another install representation would
not prove it. Source review, negative controls, and independent security
evaluation remain mandatory.

Not completed by this Generator:

- independent security evaluation;
- Windows Node/npm installation and execution of the new probes;
- safe-branch CI for the backport commit;
- production or release acceptance.

The base candidate's safe run `37656814992` is not green: its Windows full
Vitest job timed out in the existing 22-real-repository harness fixture. That
portability issue is separate from this backport and must be fixed and rerun
before a combined candidate can be called CI-ready.

## Evidence index

- `vendor/braces/PATCH-MANIFEST.json`: immutable provenance and per-file hashes.
- `evidence/internal-backport.patch`, `replay-verification.txt`: normalized
  replayable patch and clean-tarball replay.
- `evidence/upstream-pr78.json`, `upstream-pr78.diff`: captured open PR state.
- `evidence/pristine-depth-negative-control.jsonl` and
  `patched-depth-control.jsonl`: low-stack negative/control matrix.
- `evidence/compatibility-probe.jsonl`: pristine/patched normal-behavior pairs.
- `evidence/npm-audit-*.json`, `npm-ls-braces.json`, and
  `dependency-resolution-summary.txt`: audit and resolved install graph.
- `evidence/full-vitest.txt`, `verify.txt`, `lint.txt`, `build.txt`: Node checks.
- `evidence/pg16-db-probes.json`, `pg16-db-probes.txt`, and
  `browser-e2e.txt`: real PostgreSQL/browser checks.
- `evidence/css-comparison.txt`: build CSS hashes against `17b47a8`.
