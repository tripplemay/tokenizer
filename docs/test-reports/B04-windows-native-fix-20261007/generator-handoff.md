# B04 native Windows CI correction - Generator handoff

Scope: isolated CI-only upgrade candidate, not historical F005 advancement,
not an independent verdict, and not release approval.
Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b04-windows-native-fix-20261007` (detached).
Integration base: `bdd47309f8aecebea6b1c98f0d641a883e1cf46a`, including the
separately reviewed B01 owner/startup corrections.

Transported without conflict:

| Original | Local transport |
| --- | --- |
| `d01343f` B04 pinned installation | `6db828b` |
| `3cdadd8` B04 legacy path guard | `f37fb45` |
| `c8c79cf` B04 locks/redaction | `9466dc4` |
| `7b60bb6` independent evaluator report/Linux probe | `dabafea` |

The transported independent round-two verdict remains unchanged: BLOCK for
release, with CI-only progression permitted. No manifest/version/tag fabrication,
push, production/host-service modification, harness status/features/gate write,
or B05 change was performed.

## Source evidence and correction

Actual native baseline: [GitHub run 37644762713](https://github.com/tripplemay/tokenizer/actions/runs/37644762713),
SHA `7b60bb6d6662f5f677c566ffa1b3db33ac4cfb5b`. Linux Verify succeeded;
Windows Verify failed five tests; Deploy skipped. Raw failed-job output and
API metadata are retained as `evidence/native-ci-baseline-{failed.log,run.json}`.
Do not transfer results from the different `3ade5d1` combined branch/run
37645682850 to this B04 candidate.

1. **Native installer fixture model:** the prior fixture used a `node.cmd`
   batch mock behind the generated `tokenizer.cmd`, unlike production's native
   `node.exe`. CI observed its configure-failure injection returning 0. The
   corrected fixture copies the runner's actual Node executable to isolated
   `node.exe`; a CJS preload intercepts only the synthetic CLI target before
   importing tsx. Shared stub tests prove actual Node argv produces exit 42 for
   configure and exit 55 for enrollment, even with a nonexistent tsx import.
   This removes the nested-batch mock ambiguity; it does NOT yet prove the new
   PowerShell/.cmd end-to-end path passed on Windows. That requires native CI.
2. **No weakened failure/recovery assertions:** native tests still require
   nonzero failures for manifest/fetch/npm/configure/enrollment, token absence
   from both output streams, live-lock rejection, successful upgrade, offline
   rollback, and retained queue/credential canaries. Each failure now checks
   the old Git HEAD and canaries. Safe command/exit/revision traces explicitly
   require candidate configure exit 42 and candidate enrollment exit 55.
   A service-enabled failure path additionally requires the restore call to
   invoke `install-service` against revision `first`, not the failed candidate.
   Task Scheduler commands and the CLI service operation are fixture stubs;
   this is call/restore-path evidence, NOT real Task Scheduler acceptance.
   Fixture paths contain spaces to exercise actual argument quoting.
3. **CRLF order guard:** the staging-before-stop assertion is parameterized for
   LF and CRLF, uses anchored call-site patterns, requires a found staging
   command and a later found stop call, and rejects missing/premature-stop
   mutants. `line-ending-before-after.json` reproduces the original CRLF stop
   index -1 and the corrected ordering for both spellings. Product script
   ordering is unchanged.
4. **POSIX scope:** the integration base already skips the POSIX process fixture
   on Windows and normalizes CRLF in its source guard. Those B01 changes were
   preserved unchanged, rather than duplicated or undoing the platform checks.
5. **Native CI gate:** Windows Verify now runs the native installer fixture in
   isolation before the existing full suite, writes/uploads JSON, and requires
   its exact fullName to pass once on real `win32`. A skipped/missing/renamed/
   duplicate/failed result cannot pass the gate. Eight synthetic gate tests
   cover rejection; these simulations are not native Windows evidence. The
   actual macOS-skipped report was rejected by the real gate (exit 1).
   Existing full-suite, B01 owner, and PowerShell parser gates remain intact;
   deploy conditions were not changed.

Generator correction diff modifies tests/fixtures and Windows CI only. Relative
to transported `dabafea`, neither installer product script, B01 source/test,
POSIX lifecycle test, nor release ledger was changed.

## Local Generator self-tests

Node `v22.22.0`, macOS arm64, own `npm ci` (exit 0; no shared node_modules).
PATH prefix: `/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin`.
After the internal system temporary volume returned ENOSPC before any test
loaded, subsequent commands use `TMPDIR=/Volumes/ORICO/project/.b04tmp` on the
available external volume. No unrelated data was deleted. Original ENOSPC
output remains `focused-enospc-no-tests.log` and is not a test assertion result.

| Command | Observed output |
| --- | --- |
| Focused installer/release/service/gate suite (8 files) | **43 passed / 5 skipped**, exit 0; `focused-committed-source.log` |
| Standard `npm test` | **118 files passed / 9 skipped; 1542 tests passed / 23 skipped**, exit 0; `full.log` |
| `npm run verify` | Exit 0; `verify-final.log` |
| `npm run lint` | Exit 0; `lint.log` |
| `npm run build` | Exit 0; `build.log` |
| `actionlint .github/workflows/deploy-vps.yml` | Exit 0; `actionlint.log` |
| `node --check tests/fixtures/agent-release-node-preload.cjs` | Exit 0 |
| Actual macOS skipped-report / native gate | Vitest exit 0 with native test pending; gate exit 1; `windows-skipped-on-macos.json`, `gate-real-macos-rejected.log` |

The focused command selects installer POSIX/Windows/native-Node-stub tests,
release route/version, POSIX lifecycle, Windows service tests, and Windows
installer JSON gate tests. Five focused skips are the native Windows installer
and four Windows service cases. No skip or timeout was added to hide a Windows
assertion. An intermediate environment-object type annotation error is retained
in `verify-development-type-error.log`; final TypeScript verification succeeded.

Build uses synthetic, build-only inputs:
`DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:9/tokenizer_build`,
`AUTH_SECRET=synthetic-build-only-secret-0000000000000000`,
`AUTH_RESEND_KEY=re_synthetic_build_only`. No real database/secret was used.
Dependency installation reported 16 existing vulnerabilities (4 moderate,
10 high, 2 critical); no package update or security closeout is claimed here.

## CI-only handoff and release blockers

The candidate can be handed to Coordinator for a **non-main native CI rerun**;
Generator has not pushed and has no new native Windows result. Required next
evidence: Windows focused exact-test JSON gate, full suite, B01 owner gate and
PowerShell syntax step on the exact new SHA, retaining its installer observations.
The native fixture logs `B04_NATIVE_FIXTURE_OBSERVATIONS` only after assertions.

The current ledger still pins version 1.4.0 to
`2074991717abaf3cb34d9aad894bcd4357fefbc3`, not the accepted B04 candidate.
Immutable tag/publication, native macOS launchd, actual Windows Task Scheduler,
Windows reparse-point containment and the remaining cross-platform cutover fault
matrix are unresolved release gates from the independent verdict. Do not merge
or publish an Agent release on the strength of local or PR CI results alone.

`evidence/runtime.json` records local runtime/base/transport and the old native
run's exact SHA; `evidence/SHA256SUMS` records the retained evidence-file hashes.
Fresh independent review and exact-SHA native CI are still required.
