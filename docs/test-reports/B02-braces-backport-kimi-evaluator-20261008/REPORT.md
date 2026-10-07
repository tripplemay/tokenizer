# B02 braces backport — independent cross-family Evaluator report

Date: 2026-10-08
Role: independent Evaluator (Kimi, cross-family; generator was a different model family)
Candidate SHA (immutable, verified): `b6092cd82f511101f3675c680e36972098b49998`
(`git rev-parse HEAD`, detached HEAD, no remotes configured)
Base: `17b47a8e9128eef1f982afa2f5a3257ec72737d3`; candidate commits: `326e68a` (vendored
backport), `b6092cd` (Windows harness test timeout)
Evaluator runtime: Node **v25.7.0**, npm **10.8.2**, darwin-arm64 — deliberately noted:
the Generator used Node v22.22.0 / npm 10.9.4, and CI pins Node 22.
Method: all conclusions below come from the evaluator's own commands on the candidate
tree; Generator reports/logs were treated as untrusted evidence and independently
re-derived where load-bearing.

## Verdict summary

| Dimension | Result |
|---|---|
| Security remediation truth (GHSA-vfj7-8cjw-p6xm closure) | **PROVEN** for the exact candidate SHA, as an internal unofficial backport |
| Safe-branch CI readiness | **NOT PROVEN** — local L1 all green; no safe-branch run of the combined candidate exists; native Windows execution unproven |
| Production release readiness | **BLOCKED** — requires safe-branch CI green on all jobs plus the coordinator human gate; an evaluator cannot grant release |

The vulnerability closure itself is proven by independent evidence, so the remediation is
not blocked. What is blocked is any claim of CI readiness or release readiness.

## 1. Supply-chain integrity — PASS (independently replayed)

- Downloaded `https://registry.npmjs.org/braces/-/braces-3.0.3.tgz` fresh.
  - SHA-256 `1cd18e862c8640b4568b1425a7df4ee030ff201d45b2da8f9f222d2987494ffc`,
    SHA-512 `c906d780…ca71bc`, SHA-1 `490332f40919452272d55a8480adc0c441358789`
    — all three match `vendor/braces/PATCH-MANIFEST.json`.
  - SHA-512 hex → base64 equals npm integrity
    `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`,
    cross-checked against live `npm view braces@3.0.3 dist`.
- All 7 manifest-listed modified files match BOTH their recorded pristine and patched
  per-file SHA-256 values (14/14 OK). `LICENSE`, `index.js`, `README.md` are
  byte-identical to the pristine tarball.
- The evaluator's own `diff -u pristine vendor/braces` contains exactly and only:
  `MAX_AST_DEPTH: 100` (constants), `assertDepth` helper throwing
  `SyntaxError`/`ERR_BRACES_MAX_DEPTH` (utils), one guard call before each container push
  for `{` and `(` (parse), a `depth` parameter + `assertDepth` on container nodes +
  `depth + 1` propagation in `compile`/`expand`/`stringify`, and removal of upstream
  `devDependencies` from the vendored `package.json`. Nothing else.
  (The `console.log('node.isClose', …)` in compile.js and the duplicated
  `if (node.value)` in stringify.js are pristine upstream code, not patch-introduced.)
- Live upstream status (queried 2026-10-08): advisory GHSA-vfj7-8cjw-p6xm still reports
  `braces <= 3.0.3`, `patched_versions: null`; PR micromatch/braces#78 still open and
  unmerged, head `97308a01d091b211cf015314a2d0696da28a5392` — identical to the manifest's
  captured head. An internal backport remains the only available route; the vendored
  package transparently keeps version `3.0.3`.

## 2. Install graph and package-lock resolution — PASS

- `npm ci --no-audit --no-fund` → PASS, 670 packages.
- `require.resolve('braces', …)` from the root and from `node_modules/micromatch`,
  `fast-glob`, `chokidar`, `@next/eslint-plugin-next`, `tailwindcss` all resolve to
  `vendor/braces/index.js`; `node_modules/braces` is a symlink to `../vendor/braces`;
  `npm ls braces` shows `overridden -> ./vendor/braces` with all consumers deduped.
- Lockfile diff vs base: `node_modules/braces` became `{resolved: vendor/braces, link: true}`
  plus a `vendor/braces` entry (3.0.3, dev, fill-range dep). No `codeload`, `git+`, or
  `git@` resolved URLs anywhere (remaining github.com strings are `funding` fields).
  `overrides: {"braces": "$braces"}` pins every transitive consumer to the checked-in copy.

## 3. Vulnerability closure — PROVEN by evaluator's own probes

Independent probe (52 rows; string `default`/`parse`/`compile`/`expand`/`stringify`,
direct-AST `compile`/`expand`/`stringify`, parens, mixed, cyclic AST, quoted/escaped/
bracket-class, unbalanced), run at normal stack and at `--stack_size=512`:

- Patched, both stack sizes: depth 99/100 accepted on every operation; depth 101/102/4000
  rejected with `SyntaxError`, code `ERR_BRACES_MAX_DEPTH`; 100 parens accepted / 101
  rejected; brace-inside-paren mixed nesting rejected; cyclic AST (50-deep + back-edge)
  rejected with the same controlled `SyntaxError` instead of `RangeError`; quoted,
  escaped, and bracket-class `{`×101 do not consume depth budget; unbalanced `{`×101
  rejected. 52/52 rows as specified, no `RangeError` anywhere.
- Pristine negative control at `--stack_size=512` (vulnerability is real and detectable):
  `expand` string and direct-AST `RangeError: Maximum call stack size exceeded` at depth
  4000; cyclic AST `RangeError` in `compile`/`expand`; direct-AST `compile` and
  `stringify` `RangeError` at depth 50,000/200,000.
- Environment note: on Node v25.7.0 pristine `compile`/`stringify` survive depth 4000
  (newer V8 raises the crash threshold vs the Generator's Node 22 runs). The patched
  guard closes the hole semantically — independent of any V8 stack geometry — which is
  exactly why a depth bound is the correct fix shape.
- Source-level boundary check: parser calls `assertDepth(stack.length)` before pushing,
  so the 101st container (root counts as stack level 1) throws; walkers check
  `node.nodes` containers at `depth > 100`; both boundaries are identical (100 accept /
  101 reject) and consistent between parsed and direct-AST input.

## 4. Compatibility — PASS (differential, zero divergence)

Evaluator's own differential probe pristine vs patched: 854 cases × 3 invocation shapes
(`default`, `parse`+`stringify`, `compile(parse(...))`) = **2,562 comparisons, 0
mismatches**. Cases include the three real Tailwind content globs, ranges with steps and
zero-padding, negative/reverse ranges, nested alternatives, cartesian products, escapes,
quoted braces, bracket classes, parens, dollar-braces, unbalanced/invalid input, empty
and short inputs, unicode, depth-exactly-100 strings, and 800 deterministic random
brace-rich fuzz inputs. Committed focused tests `tests/vendor/braces-backport.test.ts`:
10/10 PASS. Committed probes reproduce under the evaluator's runtime.

## 5. Local L1 gates on the exact candidate SHA — ALL PASS

| Gate | Result |
|---|---|
| `npm ci` | PASS, 670 packages |
| `npm run lint` (`--max-warnings=0`) | PASS |
| `npm run verify` (tsc) | PASS, exit 0 |
| `npm test` (full Vitest) | PASS — 122 files passed / 9 skipped; **1612 passed / 23 skipped** (matches Generator's count) |
| `npm run build` (Next 16.4.0, placeholder DATABASE_URL as in CI) | PASS, full route table emitted |

End-to-end reachability during that build (preload trace shim from the route-decision
report, evaluator re-run): exactly 12 `braces` calls, all `default` operation, all
required from `node_modules/micromatch/index.js`, all three repository-controlled
Tailwind globs (`./app`, `./components`, `./src` `**/*.{js,ts,jsx,tsx,mdx}`, depth 1) ×
4 each — executing against the patched vendored copy. No lint-time `braces` calls and no
request-time path; consistent with the route decision's reachability analysis.

## 6. npm audit residual — 7 High, composition matches the claim exactly

- `npm audit`: **7 High, 0 other** — `braces` (GHSA-vfj7-8cjw-p6xm, range `<=3.0.3`)
  plus its fan-out `chokidar`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`,
  `eslint-config-next`, `tailwindcss`. `fixAvailable` is only the semver-major
  `tailwindcss@4.3.3` migration.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- Interpretation (evaluator's own): the residual is advisory matching by package
  identity — the vendored package honestly keeps version `3.0.3`, and npm's advisory
  service does not inspect local source. The installed code was proven patched by hash
  replay + resolution + probes (§1–§3), so 7 High here is metadata, not unpatched code.
  Conversely, a future zero count (e.g., via advisory-db PR 10132 reclassification) must
  not be cited as a code fix. The residual requires disposition: adopt a verified
  upstream release when one exists (removal trigger documented in
  `vendor/braces/TOKENIZER-BACKPORT.md`) or an authorized residual-risk acceptance with
  named owner and deadline.

## 7. Windows timeout scope — correctly scoped, natively unproven

- Candidate diff for `tests/cli/harness.test.ts` is exactly: a 2-line comment and a
  per-test `30_000` timeout on `caps structured issues at 20 while retaining the full
  failed-project count`. Assertions (`failed=23`, `issues=20`, `snapshot.issues=20`) are
  byte-unchanged; no global `testTimeout`, no workflow, product, dependency, or gate
  changes.
- Context verified at base SHA: the `verify-windows` job runs the full `npm run test`
  suite on `windows-latest`; safe run `37656814992` at base failed only that job
  (`harness.test.ts:577`, 14,960 ms native vs the 5,000 ms default). The fix targets
  exactly that failure and the full local suite (which includes this test) passes.
- Not proven: no native Windows run of install + probes + suite exists for this
  candidate; npm's `file:`-link + `$braces` override behavior on Windows runners
  (symlink/junction creation) is untested here.

## Limitations of this evaluation

1. Runtime difference: evaluator used Node v25.7.0 / npm 10.8.2; CI pins Node 22 and the
   Generator validated on v22.22.0. Results above are stronger for V8 variance but are
   not a Node 22 reproduction.
2. Not re-run by this evaluator (Generator evidence only, treated as unverified):
   PostgreSQL 16 five-file probe (48/48), authenticated Chromium journeys (3/3), and the
   emitted-CSS byte-identity comparison against base `17b47a8` (build itself was
   re-run and passed).
3. Pre-existing, out-of-advisory-scope residuals unchanged by the patch: `expand`
   cartesian explosion (`{a,b}`×N, memory/CPU rather than stack — the reachable project
   path uses `compile`, not `expand`); a caller-handcrafted AST with cyclic `parent`
   pointers can hang `expand`'s iterative parent-chain loop (not the advisory's
   stack-exhaustion vector; parser-produced ASTs cannot contain one).
4. Walkers bound container depth, not total node count; flat huge structures are
   linear iteration, bounded for parsed input by `MAX_LENGTH` (unchanged, 10000).
5. The 7 High audit residual cannot reach zero while the vendored version stays `3.0.3`;
   that transparency is deliberate (see §6 disposition requirement).

## Blockers

1. **Safe-branch CI for `b6092cd82f511101f3675c680e36972098b49998` has never run.**
   The only safe run (`37656814992`) was at the base SHA and its Windows job failed on
   the test this candidate patches. All jobs — including Verify (Windows) — must be
   green on a non-main branch before any CI-ready claim.
2. **Production release remains gated**: coordinator human gate + Deploy workflow are
   required; this evaluator grants no release acceptance and pushed nothing.
3. **Audit residual disposition** (non-blocking for the security fix itself, blocking
   for closing B02's advisory item): upstream release adoption or authorized
   residual-risk acceptance with owner and deadline.

## Evaluator boundary statement

No product code, tests, package files, `progress.json`, `pending_gate`, or Git
configuration was modified; no commit, push, or deployment was performed. Working-tree
additions are limited to this report directory (`git status` was clean before writing).
Temporary probe/install artifacts live under `/tmp/b02-eval` and the gitignored
`node_modules/`.
