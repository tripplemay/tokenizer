# Windows P1 INITIAL - Generator development handoff

Supporting Generator under harness-rules section 1.5. This is not a verdict,
functional acceptance, native-run result, feature completion or publication.
`release_ready=false`; all state, memory and frozen inputs remain unchanged.

## Exact source candidate

- Base: `cb198045498bb5561d1465808365a78424839755`.
- Code commit: `0f02b81c72fc399cae6826d4d49418b96ff23e15`.
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-initial-generator-20261011`.
- Source commit adds exactly the three approved CLI/test/workflow paths; no existing tracked file changes. `20-exact-diff-and-frozen.raw.log` records the actual diff, hashes and fresh non-symlink dependency directory.
- The separate report commit is this directory's latest commit: resolve with `git -c core.fileMode=false log -1 --format=%H -- docs/test-reports/BL-WINDOWS-P1-INITIAL-generator-20261011`. Its exact SHA is supplied in the final handoff. No self-referential commit hash is invented inside this file.

The new CLI contains the parent/probe, embedded additive Buffer observer,
atomic append/counter gate, strict native API/owned exit-close reconciliation,
conservative T0-T3 selection, safe evidence reconstruction and sealing. The
workflow is dedicated to the locked non-main ref and its explicit 16 safe files.
These are implementation surfaces, not claims of verified Windows behavior.

## Development evidence

| Evidence | Observed result |
| --- | --- |
| `01-npm-ci.raw.log` + status | Fresh own `npm ci`, exit 0; complete stdout/stderr retained. No borrowed modules, Node download, lock edit or second install. npm reported seven high-severity vulnerabilities; no dependency repair was attempted. |
| `02-binding-hashes.raw.log` | Both exact specifications, ten referenced input hashes, four script hashes, local schema refs and closed key/path sets checked. |
| `04-scoped-initial.raw.log` | 54 passed / 1 failed. UTF-8 `TextDecoder` default BOM removal bypassed the explicit BOM check. Corrected with `ignoreBOM:true`; initial evidence remains unchanged. |
| `06-scoped-after-bom-and-sealing.raw.log` | 60 passed / 1 failed. The synthetic provenance fixture aliased the expected hash array. Corrected with an independent cloned array; initial evidence remains unchanged. |
| `07` and `11` scoped logs/JSON | Intermediate 62- and 63-test results, not substituted for the exact candidate. |
| `14-scoped-exact-candidate.raw.log` / `.raw.json` | 64 passed / 0 failed / 0 skipped, offline synthetic/mocked and owned temporary data only. |
| `15-lint.raw.log` | Exit 0 for repository `eslint app src`; it does not lint the new CLI/test/workflow. |
| `16-verify-exact-candidate.raw.log` | Exit 0 for Prisma client generation + repository TypeScript check; no DB/service/build/E2E/native operation. |
| `17-pure-exact-candidate.raw.log` | Pure import, all 14 declared control group names, final report reconstruction, frozen bindings and exact source SHA-256 values checked. |
| `18-final-syntax.raw.log` | New MJS syntax check, exit 0. |
| `19-source-commit.raw.log` | Independent exact-three-path source commit, exit 0. |

Every command attempt has its own complete raw output and exit file. Earlier
successful checks and both failures are retained, not overwritten. `report.json`
contains all twenty-one attempts, exact source hashes, evidence file hashes and the
non-execution boundary. A later green development run is not acceptance.

`21-report-whitespace.raw.log` retains the report-only `git diff --check` exit 2:
six original raw logs end with blank lines. No raw output was trimmed or rewritten
to hide that result. The three-file source diff's whitespace check was exit 0.

Installed Node was `v22.22.0` / libuv `1.51.0` on macOS arm64. HOME, USERPROFILE,
TMPDIR and npm cache were owned paths under `/Volumes/ORICO/project/.wp1g-20261011`.
The strict lock/read/write operations and stage persistence are an explicit
observation-I/O delta, not an uninstrumented parity claim; perturbation is unmeasured.

## Remaining boundary

- No PowerShell, old diagnostic, new `--run`/`--probe`, GitHub, SSH, real Docker/DB/service or production execution.
- No push, human gate decision, state/memory/harness edit, verdict or signoff.
- Windows x64 runner/preload/EOF/cleanup behavior, PowerShell internals, whole-tree absence and the historical run remain unverified.
- Coordinator must obtain independent actual-diff scope review and applicable different-model-family functional Evaluator acceptance before separately authorized publication or native execution. These development artifacts authorize neither.
