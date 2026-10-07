# B03 scope admission independent evaluation

Date: 2026-10-07

Evaluator target: `deca9569ad780284c0934bfd1f4b9b751d765ff7`

Negative baseline: `ecdd3546a1f03044bf4c96087e3e9e6174fdf709`

## 总体结论

- **Durable admission / backlog disclosure slice: PASS_WITH_LIMITATIONS (B, Ready with follow-up).** Candidate behavior matches the approved forward-only admission semantics and fixes the independently reproduced baseline failures.
- **Complete B03 privacy closeout: BLOCKED.** `tokenizer replay` is still an unknown command. `planBoundedReplay` is only a non-executing request validator; it is not a usable dry-run or replay implementation.
- The narrow candidate is suitable for candidate-branch CI/integration. It is **not** sufficient for a B03-complete or production-cleanup claim.

## 独立行为证据

The evaluator used a detached scratch worktree and a real CLI subprocess with an isolated temporary `HOME`, a real Claude JSONL fixture, a local HTTP receiver, durable queue/cursor files, and a synthetic failed upload. No production or staging endpoint was contacted.

| Contract | Baseline `ecdd354` | Candidate `deca9569` | Result |
| --- | --- | --- | --- |
| `local-only` admits only records matching the collection-time scope | admitted `old-admitted` | admitted `old-admitted` | control established |
| Rule edit is forward-only | dropped the old admitted row and replayed `previously-excluded` history | retained old admitted row; admitted only later append `fresh-new` | PASS |
| `configure` preserves queue/cursor and does not upload | queue remained before next collection; no request | queue and cursor byte-preserved; zero requests | PASS |
| Incremental cursor exists | absent | created and preserved | PASS |
| `local-only -> sync` timing | no configure upload | no configure upload; status discloses next Agent/run/sync cycle | PASS |
| Sync ignores new collection rules for admitted backlog | old admitted row was lost | wire IDs were newest `fresh-new`, then old admitted row | PASS |
| Failed upload preserves admitted excluded-path backlog | lost from queue | preserved in queue after HTTP failure and retries | PASS |
| Fingerprint remains local | absent from wire | absent from wire | PASS |
| Paused collect preserves queue/cursor | queue changed | queue and cursor unchanged; pause disclosed | PASS |
| Historical replay CLI | unavailable | unavailable | **remaining blocker** |

Raw results:

- `evidence/baseline-negative.json`
- `evidence/candidate-admission.json`
- `evidence/SHA256SUMS`
- Probe: `scripts/test/b03-scope-admission-independent.mjs`

## Replay contract and hard limits

Independent Vitest coverage confirms the validator:

- accepts exactly one explicit Claude Code absolute literal `.jsonl` request;
- returns a frozen `dryRun: true`, `maxFiles: 1` plan;
- enforces canonical UTC `[from,to)` with a maximum 31-day range;
- enforces `maxBytes <= 16 MiB` and `maxEvents <= 5000`, including one-unit-over-limit negatives;
- rejects unsupported sources, relative paths, roots, globs, unknown options, caller-supplied widening, and execution requests;
- makes the scope fingerprint independent of upload mode and input ordering.

This is **interface validation only**. It does not prove filesystem containment or execution safety. The current function performs no `open`/`stat`, parser call, queue/cursor mutation, or network request, so regular-file checks, symlink/reparse rejection, handle identity, bounded reads, line/record/time/memory/output budgets, plan-digest confirmation, idempotent admission, and crash/concurrency recovery remain unimplemented and untested at an operational replay boundary.

## Verification

Environment:

- macOS 26.6.2 (`25G83`), Node.js `v22.22.0`.
- Dependency tree was an APFS clone of an existing candidate worktree `node_modules`; this was **not** a fresh `npm ci` proof.
- No native Linux or Windows execution was performed. Windows path spellings were contract/unit tested only.

Commands and outcomes:

- Independent baseline probe: PASS as a negative control; reproduced cursor absence, retroactive filtering/replay, failed-upload loss, missing backlog disclosure, and paused mutation.
- Independent candidate probe: PASS.
- Targeted suite: **8 files, 103 tests passed**.
- Full suite, Node 22: **116 files passed, 8 skipped; 1577 tests passed, 22 skipped**.
- `npm run verify`: PASS.
- `npm run lint`: PASS.
- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder npm run build`: PASS.
- `node --check scripts/test/b03-scope-admission-independent.mjs`: PASS.

Full-suite qualification: the first default-temp run failed three tests because the macOS root volume had only about 116 MiB free (`ENOSPC`). With `TMPDIR` moved to the external workspace volume, one lifecycle test was flaky once and passed immediately in isolation; a subsequent complete run passed with the counts above.

## Findings and residual gates

No blocking defect was found in the narrow admission/backlog slice.

1. **High / complete-B03 blocker:** no operational bounded replay CLI/parser adapter exists. Historical excluded data cannot yet be selected, previewed, or admitted through the separately bounded workflow.
2. **High / production cleanup gate:** historical cleanup or migration still requires an explicit user-approved backup/restore plan and bounded migration. No cleanup was performed.
3. **Medium / deferred privacy work:** raw diagnostic opt-in with expiry and versioned migration for path-containing identities are not part of this candidate.
4. **Medium / rollout evidence:** no live multi-tenant canary/fleet rollout was executed.
5. **Low / evidence hygiene:** `git diff --check ecdd354..deca9569` reports trailing whitespace/new blank EOFs in generator-captured `.log` evidence. Product source and evaluator diff are clean.

## 评分卡（narrow admission slice）

- Correctness: **5/5** - real CLI probe satisfies the forward-only admission and transition contract.
- Regression Risk: **4/5** - full suite is green; no fresh-install or cross-platform run was performed.
- Security: **4/5** - scope label stays local and wire payload stays minimized; replay execution controls do not yet exist.
- Reliability: **4/5** - cursor, paused state, failure preservation, retries, and queue semantics were exercised; replay/concurrency work is deferred.
- Performance: **4/5** - incremental cursor prevents full-history rescans; no workload benchmark was required for this slice.
- Maintainability: **4/5** - admission and upload responsibilities are explicit; the future replay contract is deliberately separate.
- Test Readiness: **4/5** - targeted, negative-baseline, failure, and full-suite evidence is strong, with platform/fresh-install limitations.

Weighted result: **4.25/5**. Final grade: **B** for this slice. Readiness: **Ready with follow-up** for candidate-branch CI; **Not ready** for complete B03 closeout or production historical cleanup.
