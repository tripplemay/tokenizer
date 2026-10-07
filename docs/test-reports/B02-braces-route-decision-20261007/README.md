# B02 `braces` remediation route decision (2026-10-07)

Input remains integration commit `4d96e4bb23224f393099b2187c8b42cd7a521cd8`.
This supplement does not change the prior B02 gate: **BLOCKED / ACTION_REQUIRED**.
It is not release acceptance and does not authorize residual-risk acceptance.

## Decision

1. **Preferred:** wait for a supported upstream npm release, or create an
   organization-controlled fork/backport only after source review, provenance
   pinning, and the full safe-branch matrix.
2. **Do not adopt the fresh unofficial fork directly as an approved fix.**
   `Im-Fran/braces` commit
   `11568474fd2d330d4a56a3aba63f8f90030ba15e` is a useful emergency candidate,
   not an approved dependency. Its string-input guard works and its upstream
   suite passes, but it has no upstream review, its release is not immutable,
   and direct deep AST input still reaches the vulnerable recursive walker.
3. **Removing the actual package chains is not narrow:** Tailwind 3 LTS and
   Next 16's ESLint plugin both install `braces@3.0.3`. Removing those chains
   means a separately reviewed Tailwind 4/replacement migration and/or weakening
   or replacing the Next lint stack. Neither belongs in B02 silently.
4. Expanding the three Tailwind content globs into explicit file-extension
   patterns would remove the currently observed build-time call to `braces`.
   This is defense in depth only: the package remains installed through
   Tailwind and Next ESLint, so `npm audit` remains nonzero.

## Actual reachability

The preload probe wraps the installed `braces` export without changing product
files.

- `npm run build` made 12 calls. Every call was from
  `fast-glob -> micromatch.braces -> braces` while Tailwind processed the three
  repository-controlled content globs from `tailwind.config.cjs`:
  `./app/**/*.{js,ts,jsx,tsx,mdx}` (length 30),
  `./components/**/*.{js,ts,jsx,tsx,mdx}` (length 37), and
  `./src/**/*.{js,ts,jsx,tsx,mdx}` (length 30). Each has brace depth 1.
- `npm run lint` made zero `braces` calls with the current Next 16 ESLint config
  and current source tree. The vulnerable package is nevertheless installed
  under `@next/eslint-plugin-next -> fast-glob -> micromatch`; a future rule or
  config can make it reachable.
- No public request parameter feeds these build/lint patterns. Production
  `npm audit --omit=dev` remains zero and the final image excludes builder
  `node_modules`. The demonstrated risk is CI/build availability and artifact
  integrity, not a production request-time path.

This trace covers the observed build and lint commands only. It does not prove
all future Next/Tailwind/ESLint configurations unreachable.

## Advisory and upstream status

- GitHub's reviewed advisory still says `<=3.0.3` affected and lists no patched
  version: <https://github.com/advisories/GHSA-vfj7-8cjw-p6xm>.
- Upstream issue 70 remains open and the maintainer disputes the security
  classification: <https://github.com/micromatch/braces/issues/70>.
- Advisory-database PR 10132 is open, not merged; it proposes removing affected
  versions rather than shipping a code fix:
  <https://github.com/github/advisory-database/pull/10132>.
- Upstream fix proposals 78, 79, and 82 were open with no reviews or check runs
  at `2026-10-07T16:37:58Z`. PR 78 guards parsed strings and caller-supplied
  ASTs with a small patch; PR 82 adds a more comprehensive iterative AST
  preflight but changes more traversal logic. Neither is an approved upstream
  release.

An advisory reclassification could make scanners quiet while the reproducible
`RangeError` behavior remains. It must not be described as a code fix.

## Unofficial fixed-source candidate assessment

Observed `Im-Fran/braces` release facts:

- annotated tag and merge commit are GitHub-signature verified;
- release `3.0.4` was published on 2026-10-07 and reports `immutable: false`;
- the code delta against current upstream master adds a fixed parser nesting
  limit of 100, tests, documentation, and a version bump;
- the repository has no committed npm lockfile, so `npm ci` cannot be used for
  its own test setup; after `npm install`, its 896 tests passed on Node 22.

Depth probe with `--stack_size=512`:

| Input | npm `braces@3.0.3` | fork commit |
| --- | --- | --- |
| string depth 100 | returns | returns |
| string depth 101 | returns | `SyntaxError` |
| string depth 4000 | `RangeError` | `SyntaxError` |
| caller-supplied AST depth 4000 | `RangeError` | `RangeError` |

The current Tailwind/fast-glob path supplies strings, so the fork guards the
observed call shape. It is not a complete hardening of the public AST APIs.

A simulation used the full commit SHA through an HTTPS codeload tarball, not a
mutable tag:

```text
https://codeload.github.com/Im-Fran/braces/tar.gz/
11568474fd2d330d4a56a3aba63f8f90030ba15e
```

The lock resolved version `3.0.4` with integrity
`sha512-e7NbDnK5Y5WX8GY5blKl+cjBXFVWRh+AuG0DdA1eAjW+J4ChWNwAnEPqeKPvAtxnJKxh+zeW32mNxS4T+3N9KQ==`.
Combined with the earlier B02 changes, Node 22 `npm ci`, lint, 1,586 tests, and
build passed. `npm audit` displayed zero findings in that simulation.

**That scanner result is not evidence of an npm-registry patched release.** The
fork declares version `3.0.4`, which falls outside the advisory's current
`<=3.0.3` range; GitHub still lists no patched version and npm registry latest
remains `3.0.3`. The report must retain this distinction.

## If root authorizes an emergency fork route

Prefer an organization-controlled mirror/backport over a live third-party
dependency. Required before integration:

1. review the exact upstream base and every patch line; prefer a guard that also
   rejects caller-supplied deep/cyclic ASTs (PR 78 or an independently reviewed
   equivalent) rather than the parser-only fork unchanged;
2. publish/mirror an immutable artifact, pin full source SHA and integrity, and
   record license, SBOM, reviewer, and provenance;
3. add negative tests for depth 101/4000 strings and direct ASTs, plus normal
   ranges, alternatives, escaped braces, parentheses, Windows paths, and the
   three project Tailwind patterns;
4. run upstream package tests and the project Node 22 install/verify/lint/unit/
   build checks;
5. run safe-branch Ubuntu, Windows, PostgreSQL 16, browser/E2E, OCI, recovery,
   and Tailwind visual CSS checks;
6. rerun online audits, but report scanner output separately from authoritative
   upstream/advisory state;
7. keep a named owner, removal/update trigger, and deadline for the fork.

Root remains the only release orchestrator. This evaluator did not modify
dependencies, product code, state, or gates and did not push.
