# B02 minimal dependency upgrade - Generator evidence

This implementation starts from the orchestrator-pinned integration commit
`5d8aeae6bb1c42fc2b115ef8fb04844efc001e68`. It does not alter the earlier B02
triage or route-decision reports.

This is a Generator handoff, not an independent verdict or release approval.

## Implemented scope

- pin `vitest` to `4.1.11`;
- add and pin `vite` to `6.4.4` so Vitest's broad peer range cannot select a
  newer Vite major;
- override `postcss-selector-parser` to `7.1.6` while keeping Tailwind 3;
- refresh the accepted lock nodes to `brace-expansion@1.1.21` and
  `browserslist@4.29.3`;
- regenerate the lockfile with Node `v22.22.0` / npm `10.9.4`.

Deliberately unchanged:

- Next and `eslint-config-next` remain `16.4.0`;
- Tailwind remains `3.4.19` in the lockfile;
- `braces` remains registry `3.0.3`; no third-party fork, Git dependency, or
  codeload dependency was added;
- no production configuration, CI gate, test threshold, state, or human gate
  was changed.

Resolved security-relevant nodes:

```text
vitest                         4.1.11
vite                           6.4.4
@vitest/mocker                 4.1.11
vite/node_modules/esbuild      0.25.12
vite-node                      absent
tinypool                       absent
brace-expansion                1.1.21
browserslist                   4.29.3
postcss-selector-parser        7.1.6
braces                         3.0.3 (known residual)
```

## Audit result

The final online audits report:

| Scope | Critical | High | Moderate | Total |
| --- | ---: | ---: | ---: | ---: |
| all dependencies | 0 | 7 | 0 | 7 |
| `--omit=dev` | 0 | 0 | 0 | 0 |

The seven High package findings are the already documented `braces@3.0.3`
advisory propagated through Tailwind 3 and Next's ESLint tree. This commit does
not claim audit zero or authorize that residual risk.

## Node 22 validation

- `npm ci`: PASS, clean install of 671 packages.
- `npm run verify`: PASS.
- `npm run lint`: PASS with `--max-warnings=0` unchanged.
- `npm run build`: PASS with Next `16.4.0`.
- final full-suite stability runs: three consecutive PASS results, each
  `121 passed / 9 skipped` files and `1602 passed / 23 skipped` tests.

The first clean full-suite run had one timeout in
`tests/cli/harness.test.ts` (`caps structured issues...`) at the unchanged
5-second threshold. A focused cold retry also timed out; an immediate complete
retry passed, followed by the three consecutive passes above. No timeout or
test configuration was weakened. This remains a cold-start timing observation
for the independent evaluator and safe-branch CI, not a hidden green result.

## PostCSS/Tailwind CSS compatibility

Because `postcss-selector-parser@7.1.6` is a transitive major override, an
unchanged TypeScript/unit result is insufficient. A second archive of the base
commit was installed and built with the original lock, and its produced CSS was
compared to the candidate build.

Both emitted CSS chunks are byte-identical, including filenames and SHA-256:

```text
017dd561560fe7511dbd67c8ef94f8a9e8d77231498d20f54fe84ebdf7984341  0ogneuwxfzjvm.css
72acce2f97679739ac04624e00e782c11727d60829890695efab7f3bb2cb3947  0721-9xv87gao.css
```

Assertions also found the expected dark-mode, responsive media, width, hover,
and Tailwind ring tokens. This proves identical build output for this source
snapshot; it does not replace complete human visual acceptance.

## Real PostgreSQL 16 and browser checks

A local Homebrew PostgreSQL `16.13` scratch cluster was initialized for this
run and stopped afterward. No production database or configuration was changed.

The first database-probe attempt failed because the local cluster inherited
`Asia/Jakarta`. `UsageEvent.occurredAt` is `timestamp without time zone`, while
the range probe casts boundaries to `timestamptz`, so the scratch role timezone
shifted the comparison. The exact same focused probe failed on the original
Vitest `2.1.9`; this was not a Vitest 4 regression.

The scratch roles were then set to UTC solely to reproduce the Ubuntu CI
contract. Under UTC:

- original Vitest `2.1.9` focused baseline: 2/2 PASS;
- candidate Vitest `4.1.11`, CI-identical five-file PG probe command: **48/48
  PASS, zero skipped**;
- query-count assertion, concurrent approval 200/409 negative control, poison
  payload, tenant/cache-key, and cost recomputation probes remained active.

Against a separate migrated `tokenizer_e2e` database on that PostgreSQL 16
cluster, the production Next server and cached Chromium completed all three
authenticated Playwright journeys:

```text
3 passed (35.2s)
```

The browser pass provides real DOM/journey coverage in addition to the CSS
byte comparison. It is local macOS ARM evidence, not safe-branch Ubuntu or
production verification.

## Remaining boundaries

- GitHub safe-branch Ubuntu/Windows/PG/browser/OCI/recovery jobs were not run by
  this Generator; root is the sole release orchestrator.
- The seven `braces` High package findings remain unresolved and need the
  separately documented upstream/backport or authorized-risk decision.
- Production and human visual acceptance were not performed.
- The cold full-suite timeout observation requires CI/evaluator attention even
  though the subsequent full runs were stable.

## Evidence index

- `evidence/npm-audit-all-final.json` and
  `evidence/npm-audit-production-final.json`: final online audit payloads.
- `evidence/npm-ls-final.json`, `resolved-versions.txt`: resolved graph.
- `evidence/node22-validation-summary.txt`, `test-retry-summary.txt`, and
  `full-test-stability.txt`: clean-install and full-suite history.
- `evidence/b02-css-*-hashes.txt`, `css-comparison.txt`: baseline/candidate CSS.
- `evidence/pg16-db-probes-serial.json`: preserved initial non-UTC failure.
- `evidence/pg16-db-probes-utc.json`, `pg16-utc-summary.txt`: final PG16 result.
- `evidence/pg16-vitest2-baseline-utc-summary.txt`: original-version control.
- `evidence/browser-summary.txt`: authenticated browser result.
- `generator-result.json`: machine-readable handoff.
