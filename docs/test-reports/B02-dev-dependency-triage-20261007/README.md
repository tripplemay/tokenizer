# B02 development-dependency triage (2026-10-07)

## Result

**Current B02 release gate: BLOCKED.** This is a research and Generator handoff,
not release acceptance.

The immutable input is integration commit
`4d96e4bb23224f393099b2187c8b42cd7a521cd8`. With Node `v22.22.0` and npm
`10.9.4`, the checked-in lockfile reports:

| Audit scope | Critical | High | Moderate | Total | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `npm audit` | 2 | 10 | 4 | 16 | 1 |
| `npm audit --omit=dev` | 0 | 0 | 0 | 0 | 0 |

All reported packages are development/build/test dependencies. They are absent
from npm's production dependency graph, and the final Docker stage copies the
Next standalone output rather than `node_modules` (`Dockerfile:17-24`). This
means there is no demonstrated public-request-to-vulnerable-package runtime
path. It does **not** make the findings harmless: Tailwind/PostCSS runs during
the production build, ESLint runs in CI, and Vitest/Vite/Tinypool runs on CI
runners. A build/CI compromise can taint release artifacts.

The tested narrow proposal removes both Critical findings and every Moderate
finding, but it leaves **7 High package findings**. Those seven are propagation
of one `braces` advisory through the Tailwind 3 and Next 16 ESLint trees. As of
this audit, the npm registry has no patched `braces` release: latest is `3.0.3`
and GHSA-vfj7-8cjw-p6xm covers `<=3.0.3`. Therefore the gate cannot honestly be
called clean while also preserving Next 16 and Tailwind 3.

## Exact installed graph and remediation

### Vitest/Vite cluster: remediate now

Current path:

```text
root -> vitest@2.1.9
  -> tinypool@1.1.1
  -> vite@5.4.21 -> esbuild@0.21.5
  -> vite-node@2.1.9
  -> @vitest/mocker@2.1.9
```

Audit package findings and fixed boundaries:

- `vitest` Critical, vulnerable `<=4.1.10`; first release satisfying both
  Vitest advisories is `4.1.11` (GHSA-5xrq-8626-4rwp and
  GHSA-82fw-gwwq-j7x9).
- `tinypool` Critical, vulnerable `<=2.1.1`; first fixed is `2.1.2`.
  Vitest `4.1.11` removes this dependency from the resolved graph, so a direct
  Tinypool override is unnecessary.
- `vite` High, vulnerable `<=6.4.2`; first fixed is `6.4.3`. Pinning `6.4.4`
  keeps the proposal on the lowest compatible safe Vite major instead of
  allowing Vitest's broad peer range to select Vite 7 or 8.
- `vite-node` Moderate `<=2.2.0-beta.2` disappears with Vitest 4.
- `@vitest/mocker` Moderate `<4.1.11` resolves to `4.1.11`.
- nested `esbuild` Moderate `<=0.24.2` resolves to `0.25.12` through Vite
  `6.4.4`. The unrelated top-level `esbuild@0.28.2` was already safe.

Do not use `npm audit fix --force`: npm proposed Vitest `5.0.3`, which is a
larger major jump than required. The tested proposal pins:

```json
"vite": "6.4.4",
"vitest": "4.1.11"
```

### Lock-only safe updates: remediate now

- `brace-expansion@1.1.14` is reached through ESLint's `minimatch@3.1.5`.
  The aggregate vulnerable range is `<=1.1.20`; update the lock node to
  `1.1.21`. A separate nested `brace-expansion@5.0.12` was already safe.
- `browserslist@4.28.2` is reached through Autoprefixer and Babel under
  `eslint-config-next`. The vulnerable range is `<=4.28.6`; the first fixed
  release is `4.28.7`. The tested lock update selected current `4.29.3`.

Both existing parent semver ranges accept these releases. They do not require
permanent overrides. In the simulation, `npm update brace-expansion browserslist
--package-lock-only --ignore-scripts` selected the safe versions; the Generator
must review and commit the resulting lockfile rather than copying the simulation
blindly.

### Tailwind selector parser: narrow override, with CSS regression gate

`tailwindcss@3.4.19` and `postcss-nested@6.2.0` resolve
`postcss-selector-parser@6.1.2`. The current aggregate advisory is `<7.1.6`, so
there is no safe 6.x. The tested proposal preserves Tailwind `3.4.19` and adds:

```json
"overrides": {
  "postcss-selector-parser": "7.1.6"
}
```

This is a transitive major override, not a Tailwind 4 migration. Local build and
tests passed, but the Generator must treat rendered CSS as a compatibility gate;
a green TypeScript/unit run alone is insufficient.

### `braces`: no clean registry fix under the stated constraints

Current paths:

```text
root -> tailwindcss@3.4.19
  -> chokidar@3.6.0 -> braces@3.0.3
  -> fast-glob@3.3.3 -> micromatch@4.0.8 -> braces@3.0.3
  -> micromatch@4.0.8 -> braces@3.0.3

root -> eslint-config-next@16.4.0
  -> @next/eslint-plugin-next@16.4.0
  -> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3
```

The resulting audit package entries are `braces`, `chokidar`, `fast-glob`,
`micromatch`, `tailwindcss`, `@next/eslint-plugin-next`, and
`eslint-config-next`, all High because of GHSA-vfj7-8cjw-p6xm. Registry facts at
the audit timestamp:

- `braces` latest: `3.0.3`; no `3.0.4` exists.
- Tailwind `v3-lts`: `3.4.19`; latest is `4.3.3`.
- Next and `eslint-config-next` latest: `16.4.0`.

Npm's forced suggestions are therefore unsafe for this work package:

- `eslint-config-next@14.2.35` would downgrade Next's lint stack from 16 to 14.
- `tailwindcss@4.3.3` is an explicit framework migration, not a dependency
  patch, and must not be introduced silently.

Do not override `braces` to a non-existent version or an unreviewed Git URL.
Choose one explicit gate disposition after the immediate fixes:

1. wait for a patched npm release/upstream dependency update; or
2. separately review and test a maintained patched fork with provenance and
   integrity pinning; or
3. have the authorized human accept this build/CI-only residual risk with a
   named owner, deadline, and the mitigations below.

Suggested mitigations pending a patch: keep glob/config/CSS inputs repository-
controlled; do not pass request/user data into these parsers; retain CI time and
resource limits; keep pull-request tokens least-privileged and secrets absent;
monitor `braces`, Tailwind 3 LTS, and Next's ESLint tree weekly. This report does
not itself grant that risk acceptance.

## Tested proposal and limits

An isolated archive of the input commit was changed only for simulation. The
scratch evaluator worktree's package files were not modified. Proposed package
changes are recorded in `evidence/proposed-package-json.diff`; the generated
lock diff is evidence only, not an implementation patch.

Resolved proposal:

| Package | Proposed resolved version |
| --- | --- |
| `vitest` | `4.1.11` |
| `vite` | `6.4.4` |
| `@vitest/mocker` | `4.1.11` |
| Vite nested `esbuild` | `0.25.12` |
| `tinypool` | absent |
| `brace-expansion` | `1.1.21` |
| `browserslist` | `4.29.3` |
| `postcss-selector-parser` | `7.1.6` |
| `braces` | `3.0.3` (residual) |

Node 22 simulation results:

| Check | Result |
| --- | --- |
| `npm ci` | PASS, 670 packages installed |
| `npm audit` | expected nonzero; 0 Critical, 7 High, 0 Moderate |
| `npm audit --omit=dev` | PASS; 0 findings |
| `npm run verify` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS; 117 files / 1,586 tests passed, 8 files / 22 tests skipped |
| `npm run build` | PASS |

This local simulation does not replace safe-branch CI, Windows, PostgreSQL 16,
browser/E2E, Docker/OCI, recovery, authenticated visual CSS checks, or production
verification.

## Generator handoff / required test matrix

1. Apply the narrow package/lock changes on a Generator branch; do not copy the
   absolute paths in the evidence diff.
2. Assert exact versions with `npm ls vitest vite @vitest/mocker esbuild
   brace-expansion browserslist postcss-selector-parser braces`.
3. Run online `npm audit` and `npm audit --omit=dev`; compare to 7 High / 0
   production findings and investigate any drift rather than updating this
   expectation mechanically.
4. Run Node 22 `npm ci`, `npm run verify`, `npm run lint`, `npm test`, and
   `npm run build`.
5. Run the repository's safe-branch GitHub matrix: Ubuntu verify/build,
   Windows native checks, PostgreSQL 16, browser/E2E, Docker OCI, and recovery.
6. Visually compare generated Tailwind CSS on login, authenticated navigation,
   tables/cards/modals, dark mode, and responsive breakpoints. The parser major
   override makes this mandatory.
7. Record an authorized disposition for the residual `braces` High advisory
   with owner and deadline before calling B02/release ready.

## Evidence index

- `evidence/npm-audit-all.json`: original online audit and advisory URLs.
- `evidence/npm-audit-production.json`: original production-only zero result.
- `evidence/npm-explain-affected.txt`: exact installed dependency paths.
- `evidence/npm-registry-snapshot.json` and
  `evidence/npm-registry-supplement.txt`: npm registry versions, tags, engines,
  and dependency ranges.
- `evidence/simulation-audit.json`: proposed graph, 7 residual High findings.
- `evidence/simulation-audit-production.json`: proposed production-only zero.
- `evidence/b02-minimal-node22-validation-summary.txt`: Node 22 command results.
- `evidence/proposed-package-json.diff` and
  `evidence/proposed-package-lock.diff`: research-only proposed diff.
- `advisory-matrix.json`: concise package/path/fix inventory.
- `verdict.json`: machine-readable gate result.
