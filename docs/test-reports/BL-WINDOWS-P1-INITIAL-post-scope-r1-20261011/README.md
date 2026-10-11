# Windows P1 INITIAL: independent actual-diff scope revision 1

**PASS, scope-only.** The four authorized minimal repairs close the reviewed
static source-path counterexamples. This is not execution of those controls,
different-model-family functional acceptance, native/CI acceptance, publication
approval or release signoff. All those flags, main/prod authority and
`release_ready` remain false. The original actual-diff **BLOCKED** report is
preserved, not rewritten.

## Exact candidate and diff accounting

- Source: `888a5acd7a8a441c9ec4ad898453f149cf8d6b7c`.
- Parent: `13f4802ebba124fe84500954087fbb91c09cee11`.
- Tree: `19186fe317bce76857dc273a9c21b3e940da9e41`.
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-initial-post-scope-r1-20261011`.
- Start and immediately pre-report status: clean; batch remains `building`,
  F004/F005 pending, `release_ready=false`.

Parent-to-source changes exactly the approved CLI and diagnostic-local test:
149 insertions, 14 deletions, whitespace check exit 0. No fourth source file.
`0f02b81 -> 13f4802` adds only **47 original development evidence files**, not
47 source files; the repair diff preserves all of them. The full feature-code
diff from `cb198045` still consists only of the original three new CLI/test/
workflow paths. The workflow, locked binding pair, seven frozen runtime inputs,
three prior inputs, old source/worker/tests/evidence/state/harness/memory remain
unchanged. All ten frozen/prior hashes and four script hashes matched.

Sole repair authority is the current Coordinator pair:

| Authority input | SHA-256 |
|---|---|
| `initial-post-scope-and-repair-adjudication.json` | `160196daa3d0f4470bbb54faaf41cd3d7944656fe1f634d705b1668fae7759a7` |
| `initial-repair-addendum-root-symbol.json` | `b671095384fceb2224269750ae9d93455680f17c1930ca0275d10fc6e989d70f` |

Both are under the release-readiness worktree's
`docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/`. Their base and
two-path allowlists match. Original pre-BLOCKED and r1 written-B001 PASS were
read as prior reports; neither is implementation acceptance.

Below, `CLI` means `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`
and `TEST` means `tests/diagnostics/windows-p1-stages.test.ts`.

## Four static closures

### PS001: actual sealed bytes are no longer scratch recovery input

`CLI:949-986,992,1011-1043`; `TEST:583-613`; bindings MD `81-83`.

Seal uses only the scratch recovery loader. Immediate upload verification uses
only the new strict sealed loader: actual bounded owned bytes must parse
validly and equal their canonical rebuilt bytes; every skipped guard/trace must
have actual length zero. It neither reconstructs a sealed record nor writes any
sealed file. Manifest equality remains a separate check.

The old T2.trace canary plus refreshed manifest now fails parsing. BOM, invalid
UTF-8, blank/whitespace/noncanonical bytes fail validity or byte equality; even
a valid nonempty skipped row fails the zero-byte check. All eight variant/
family paths take that check. Tests declare seven payloads per path, manifest
refresh and all-sixteen-file no-rewrite assertions, plus separate scratch
recovery. **These tests were not run by this critic.**

### PS002: only ESRCH is recognized absence

`CLI:529-531,548-549,566-577,830-856`; `TEST:77-114,395-414`.

Either existing sample can set a monotonic `samplingUnknown` flag for every
query failure other than explicit `error.code === 'ESRCH'`. Later ESRCH cannot
clear it. The flag independently forces cleanup unknown/root retention;
`healthTrust` then fails, observation is incomplete and T1/T2 selection stops.
Root deletion is withheld. Permission/unsupported/unknown/missing-code errors
cannot become known death even with all other inputs canonical.

The two signal-0 sample passes, observed-PID set, conditional wait, timers and
signal behavior are unchanged. No extra query or cleanup allowance. Declared
VM controls cover ESRCH positives and five uncertain error categories at either
sample at both progression boundaries; no actual process query was performed.

### PS003: invalid/overflow does not conceal actual missing EOF

`CLI:272-281,495-513,537-564,852-856`; `TEST:179-187,415-429`.

The retention condition now independently checks both actual EOF flags and
their conjunction, regardless of parser state. Invalid/unexpected-bytes or
native-output-cap plus either missing EOF therefore forces cleanup unknown and
retained root. The stream's invalid state/reason, overflow precedence, marker
facts and actual flags are preserved. `stage.valid` is already false, so the
earlier completeness calculation cannot make this incomplete observation true.
The old static deletion counterexample no longer reaches `rmSync`.

### GEN-R1-BLOCKER-001: pathname no longer shadows launcher

`CLI:765-828,892-900`; `TEST:77-114,395-429`.

Only the local pathname symbol and its path/environment references become
`runDirectory`. The original real `runRoot` function and parent pathname caller
are unchanged; the existing call is lexically callable rather than invoking a
string. No launcher/selector/retry was added.

The test helper slices the exact current `expectedProcesses` and `runCase`
bodies without transformation and evaluates them in a **test-only VM**, passing
a pathname string. Mock launch/liveness/filesystem/health/clock bindings exist
only there. The real CLI has no VM, runtime DI, environment/CLI bypass or changed
defaults. This verifies the mock control's static boundary, not its execution or
actual native launcher/timer behavior. Separate pre-repair blocker MD/JSON were
read and hashed; their before-edit chronology and failed-run logs were not
independently authenticated.

## Checks and precise identities

All Git invocations used `-c core.fileMode=false`. Read-only identity/diff/name-
status/stat/whitespace checks, full repair diff, all current CLI/test/workflow,
both locked specs, required prior reports and current authority inputs were
inspected. A builtins-only Node checker, with no diagnostic import/function or
VM evaluation, verified paths/hashes, six byte-equal sensitive source blocks,
six workflow commands, sixteen explicit upload paths, fifteen manifest entries
and the eleven-source provenance set. B001 four-owned-exit/close/API-source
closure, E0/script/budget/cap/selection/guard API and upload scope did not expand.

The first reviewer checker invocation failed before execution because I wrote
an extra right parenthesis: `SyntaxError: Unexpected token ')'`, exit 1. The
corrected inline checker exited 0. No file or diagnostic code ran in either.
This is recorded in verdict C04/C05 rather than hidden. The checker used host
Node v25.7.0 for static builtins only, not target Node22 functional validation.

| Candidate | Bytes | SHA-256 |
|---|---:|---|
| CLI | 73022 | `3a2d4174c1b2ac3b0caddb4b10c2ba9146c1569247dc6bd6084be01070a4346b` |
| TEST | 53608 | `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132` |
| workflow | 3103 | `94aa4fa7b31c49dacb71e2643976314351b7a9ad770b51a6e7d982a344bd962b` |
| binding MD | 19264 | `bf60ca426602d00b76515091cc30abd37badea21731b6ad21fe54cd323d7577c` |
| binding JSON | 34330 | `ed24ebf3b4b1890f84f09ba82edd0d71f75a12e35504a84a3fb0f9d8300455fc` |

The original actual-diff report pair matches its original verdict commit
`93af1d0143d302bcd86da9ad9ac860e1f38d80c3` and README EOF-format tip
`936ddd277a233b834d2b422e0be22c77cb882f47`, plus current authority hashes:

- Verdict: `cd8d4e1edcbb69a6702932baba9fd74f9b2b927b6156141cd99b50f5e6be3406`.
- README: `0f726a7a6255a5bc9d471bce2bee2de057d903287eb00331a44c39e9c59f49c6`.

Generator r1 report `b34dd77fbf13e737032887cdaab23b3dc851c310` and its pair were
read/hashed only. Its **81 green** development result is narrative, not an
independently executed or accepted control. No raw development inventory or
original 59-file Windows log inventory was re-certified. `verdict.json` records
the full input/source/report hashes and exact static paths. This report pair's
own hashes/commit/clean status are delivered after commit, not self-referenced.

## Remaining gates

Fresh applicable **different-model-family functional acceptance** must execute
and assess exact-source controls. Real launcher/API/worker/health writer/locks,
Windows query semantics, native EOF/cleanup/timer ordering, perturbation and
runner provenance remain unproved here. Native exact-candidate/CI execution and
publication require separate Coordinator authority. INITIAL is still only a
diagnostic, not a product P1 repair or original failure closure. Other release,
Compose/provider/backup-recovery/deployment and F004/F005 gates remain open.

No module import, test/VM/control execution, native/old/new probe, PID query,
install/network/CI/push/production action, source/spec/workflow/state/harness/
memory/old-evidence change or `pending_gate.decision` write occurred. Only this
new report pair is written and exact-path committed. Main/prod/release-ready
state does not advance.
