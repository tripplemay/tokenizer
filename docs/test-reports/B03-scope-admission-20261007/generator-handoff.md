# B03 durable admission slice - Generator handoff

This is an isolated upgrade candidate, not historical F005 advancement and not
an independent acceptance verdict. Base: `ecdd3546a1f03044bf4c96087e3e9e6174fdf709`.
Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-b03-privacy-semantics-20261007`.
Branch: `codex/b03-privacy-semantics-20261007`. No push, production data cleanup,
or harness status/features/gate write was performed.

## Delivered slice

- `collectEvents` remains the admission-time include/exclude filter. Agent,
  CLI collect/sync, and `syncEvents` no longer retroactively filter an admitted
  queue against new path rules. Minimization/Git sanitization and upload-mode
  gates remain active.
- CLI `collect` now uses the existing incremental cursor, persisting queue
  before cursor. Rule edits preserve queue/cursor and do not cause excluded
  history to be recollected. Paused collection returns before cursor/queue work.
- CLI configure/status/collect/sync disclose admitted backlog count. Switching
  local-only to sync does not upload inside configure; its explicit notice says
  automatic upload occurs at the next Agent/run/sync cycle.
- A hash of canonical collection rules labels current scope in CLI status and
  the last collection in local state. It excludes upload mode, does not reset
  cursors, is not per-record provenance/authorization, and is not a wire field.
  Existing queue schema, parser cursor implementation, and event-ID generators
  were not changed.
- `planBoundedReplay` is a pure, frozen, fail-closed interface contract ONLY:
  one literal absolute Claude JSONL file, explicit canonical UTC interval <=31
  days, explicit <=16 MiB / <=5000-event budgets, non-executing default plan.
  Unsupported sources, recursive/home/root/glob scope, unknown file counts,
  missing/excess budgets, and execution requests are rejected by tests.
  **No usable replay/dry-run CLI or explicit-file parser adapter is provided.**
  Implementation guardrails and the next R07 slice are specified separately in
  `docs/specs/B03-scope-admission-slice-20261007.md`.

## Before/after evidence

All fixtures use temporary HOME/USERPROFILE and synthetic events, not user logs.
The real CLI probe disables all source discovery and uses local-only mode.

| Input / observed result | Baseline ecdd354 | Candidate |
| --- | --- | --- |
| Already-admitted `/work/old` row; current include `/work/new`, exclude `/work/old`; CLI collect | CLI exits 0, backlog **1 -> 0** | CLI exits 0, backlog **1 -> 1**, same ID |
| New Agent/sync tests with old admitted backlog outside current scope | Both fail (queue loss / empty wire POST) | Focused tests include these cases |

Artifacts: `evidence/real-cli-backlog-{baseline,fixed}.json`, reproducible probe
`evidence/real-cli-backlog-probe.mjs`, and `evidence/baseline-backlog-negative.log`.
The probe returns 1 on the baseline because its preservation assertion detects
data loss; the CLI itself returned 0. The candidate probe returns 0.
The detached baseline worktree has its own `npm ci` and is recorded clean in
`evidence/runtime.json`; no dependencies are shared with the candidate.

The real process integration test also exercises the actual Claude JSONL parser:
old admitted row + previously excluded row, changed rules, append a new row,
collect, mode switch, status, then loopback HTTP sync. It asserts no cursor
change on configure, no historical replay of the excluded row, no HTTP request
on configure, both admitted IDs uploaded on the next sync, empty resulting
queue, and no fingerprint on wire. A separate real CLI negative asserts paused
collect and unknown `replay --source all --file / --execute` preserve queue/cursor.
The loopback server is synthetic; it is not PostgreSQL/production verification.

## Generator self-test results (Node 22.22.0 / macOS arm64)

Commands below run from the candidate with
`PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:$PATH`.

| Command | Observed result / artifact |
| --- | --- |
| `npm ci` (candidate and isolated baseline) | Exit 0; `npm-ci.log`, `baseline-npm-ci.log` |
| `npx vitest run tests/cli/{privacy,replay-contract,agent-sync-checkpoint,sync-retry,privacy-admission-cli}.test.ts` | Final: **5 files / 64 tests passed, 0 skipped**; `focused-final.log` |
| `npm test` first run | **115 files / 1564 tests passed, 22 skipped**, exit 0; `full.log` |
| `npm test` final rerun | **114 files / 1563 tests passed, 1 failed, 22 skipped**, exit 1; `full-final.log` |
| `npm run lint` | Final exit 0; `lint-final.log` |
| `npm run verify` | Final exit 0 (Prisma generate + TypeScript); `verify-final.log` |
| `npm run build` | Exit 0 with synthetic build-only DB/auth values; `build.log` |
| Real baseline/candidate CLI probe | Exit 1 / exit 0 respectively; JSON artifacts above |

The first full run preceded the final single-read status snapshot change and
the additional unknown-`maxFiles` assertion in an existing test. The final
focused/lint/verify/build runs cover the committed source. Final full rerun's
only failure is the **unchanged B01 SIGTERM launcher/owner race** at
`tests/cli/agent-lifecycle.test.ts:155`: the test starts `tsx/dist/cli.mjs`, waits
for launcher close, and transiently still sees the real owner's lock. This
slice does not modify that test or `bin/tokenizer`. Coordinator requested that
the failure remain visible, and will integrate the separately reviewed B01
fix before combined full regression. **This candidate is not single-tree
stable full-suite green.** No sleep/skip/timeout extension was added.

Earlier development output is retained, including a post-fix assertion failure
caused by existing sanitizer-added null Git fields (`focused-backlog-after.log`);
the final assertion checks admitted ID/count and matches the sanitized event.
Dependency install reported 16 existing vulnerabilities (4 moderate, 10 high,
2 critical); this slice does not alter package files or claim security closeout.

Build-only inputs were `DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:9/tokenizer_build`,
`AUTH_SECRET=synthetic-build-only-secret-0000000000000000`, and
`AUTH_RESEND_KEY=re_synthetic_build_only`; no real secret/database was used.

## Replay and remaining B03 boundaries

Replay negative tests validate an interface, not filesystem safety of a usable
adapter. R07 must implement explicit-file parsing without HOME-wide discovery,
safe regular-file/handle checks (including symlink/reparse/growth/TOCTOU), bounded
records/time/memory/output, original-path event identity, no partial admission
on failure, read-only dry-run, and separately confirmed execution. These remain
unimplemented. The current normal parser discovery is not a filesystem sandbox;
include/exclude govern event admission, not which files normal parsers may read.

No complete B03 claim: diagnostic raw-payload opt-in/expiry, path-containing ID
migration, historical production backup-approved cleanup, actual fleet/UI/live
multi-tenant canary acceptance, and the operational R07 replay CLI remain open.
Queue ACK/concurrent-writer/corruption recovery is also not redesigned here.
22 full-suite skips are retained; native Windows and live-DB skipped coverage
must not be represented as verified by macOS tests.

Independent Evaluator must inspect this commit and reproduce the privacy
admission/cursor/mode/wire cases. Coordinator owns integration, combined-suite
verification, and any later deployment decision. Evidence hashes are listed in
`evidence/SHA256SUMS`; this handoff does not substitute for an independent verdict.
