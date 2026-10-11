# Windows P1 INITIAL: independent actual-diff scope review

**BLOCKED: three locked safety invariants are not fully maintained.**

This is a fresh supporting scope critic under harness-rules section 1.5, not
Generator, a different-model-family functional Evaluator, native acceptance,
publication approval or release signoff. All functional/native/CI/publication/
release flags remain false. No product or new synthetic tests were executed.

## Exact candidate and scope

- Source HEAD: `0f02b81c72fc399cae6826d4d49418b96ff23e15`
- Parent: `cb198045498bb5561d1465808365a78424839755`
- Source tree: `72a6f6e76c699b92d73b194b3ed6b9f4aea0b3ae`
- Worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-initial-post-scope-20261011`
- Start and pre-report content status: clean.
- `progress.status=building`, `BL-RELEASE-READINESS`, `release_ready=false`.

The full actual parent/source diff adds exactly the three authorized files,
1694 lines, with no existing-file edit and a clean whitespace check:

1. `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`
2. `tests/diagnostics/windows-p1-stages.test.ts`
3. `.github/workflows/windows-p1-stages-diagnostic.yml`

The locked MD/JSON bindings, seven frozen runtime/dependency inputs, three prior
inputs and original BLOCKED/fresh r1 reports are preserved. Coordinator's
`initial-r1-scope-and-generator-adjudication.json` matches the exact parent,
paths, binding hashes and r1 report hashes. The r1 PASS closes **written B001
specification scope only**, not this implementation.

In the evidence below, `CLI` means `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`.

## Blocking findings

### PS001: invalid skipped public streams survive immediate upload verification

Evidence: `CLI:944-956,1019-1026`; bindings MD `81-83`; workflow `44-66`.

`loadCaseEvidence` reads skipped-case guard/trace bytes, but if a parse is invalid
the skipped branch suppresses that fact and returns empty rows with
`invalid=false`. The upload verifier trusts this rebuilt representation after
checking the manifest against the **actual** file bytes. It does not replace the
unsafe sealed file.

Static counterexample: start from an otherwise valid T0/T1-success sealed set,
where T2/T3 are skipped. Replace only `upload/T2.trace.jsonl` with
`RAW-STDERR-CANARY\n`, then refresh only that manifest entry's SHA-256/size.
The canary parser rejects the file; the skipped branch launders that rejection
to an empty canonical stream. All remaining verifier conditions can pass, and
the explicit upload still includes the original canary bytes.

This is not the permitted seal-time rebuilding of invalid **scratch** evidence
to a safe empty public file. Immediate verification must validate the sealed
bytes that will actually be uploaded.

Minimum repair, same approved CLI/test paths only: separate scratch recovery
from strict sealed validation; reject every invalid sealed stream before skip
handling, and require genuinely empty canonical streams for skipped cases.
Cover both skipped guard/trace families with invalid/canary bytes plus a valid
refreshed manifest. Existing negatives cover active T0, not this skipped path.

### PS002: unknown PID sampling becomes trusted cleanup absence

Evidence: `CLI:829-851,529-550,565-575`; bindings MD `44,48,64`.

The liveness sampler catches **every** `process.kill(pid, 0)` error and returns
false. With canonical T1/T2 refusal inputs, a non-absence query error such as
EPERM in both samples produces empty possible-live lists. There is no independent
sampling-unknown term in `cleanupUnknown`. This can allow a complete clean
observation, T2/T3 progression and root deletion despite an unverified owned PID.

The old frozen CLI used a similar coarse catch. That is not a waiver of the
locked new specification's independent cleanup-trust requirement. This report
does not modify or certify the old CLI.

Minimum repair, same approved CLI/test paths only: retain tri-state sampling or
a separate unknown flag; only a positively recognized absent-process outcome
may establish absence. Propagate all unsupported/non-absence query failures to
cleanup unknown, root retention and no progression. No extra queries, process
name scan, historical-PID termination, new allowance or file is required.

### PS003: invalid stream state masks independently missing EOF

Evidence: `CLI:89-99,272-281,495-512,548-562,849-851`; bindings MD `38-44,48,64`.

The recorder correctly gives parser invalidity priority over missing EOF.
However, the evaluator's retention condition only checks
`stream.state === 'unknown'`, not independently unobserved EOF.

Static counterexample: canonical T1 refused API/native four-fact tuple and
empty prefix, with a safe stream-end `state=invalid`,
`reason=unexpected-bytes`, `stdoutBytes=1`, `stderrBytes=0`,
`combinedBytes=1`, `acceptedMarkers=0`,
`stdoutEofObserved=false`, `stderrEofObserved=true`,
`eofObserved=false`. That event shape is admitted. Observation is incomplete
and selection stops, but known health can remain
`cleanupUnknown=false,rootRetained=false`; `runCase` then deletes the root.

Minimum repair, same approved CLI/test paths only: derive missing-EOF uncertainty
independently of parser-state precedence and force cleanup unknown/root retention
for it, even when the stream is already invalid/overflowed. Preserve the first
parser reason. Add an invalid-plus-missing-EOF case/cleanup control.

These three counterexamples are **static source-path derivations**. They were
not run against the new module, mocked implementation, native runner or CI.

## Structures present, not functionally accepted

The actual code contains, rather than merely promises:

- T0-T3 exact scripts/hashes, E0/old-trace/common-guard only, one admission per
  case and maximum four; sequential T1 success STOP, only clean empty-prefix
  T1 to T2 and clean json-enter-only T2 to T3; no T4/T5/module/P2/downstream.
- Worker-process, pre-return additive Buffer listeners, synchronous safe stage
  persistence, strict ordered ASCII LF/CRLF parser, byte saturation and actual
  per-stream end flags. No worker output/results/timer modification.
- Exact-target atomic mkdir append locks, saved pre-trace primitives, owned
  regular-file identity, inclusive aggregate size+candidate limits, counter
  read/check/append in one lock, no retry or stale takeover. The old trace
  captures the gated append, with builtin export synchronization.
- B001 actual API instance return/catch source, strict native tuples,
  workerKind from old trace, all four unique same-owned-native guard/trace
  exit/close facts and return equality. Node worker status is not native status;
  throw return fields stay null. Both T1/T2 counterexample groups are declared.
- Closed root/event/schema reconstruction, nullable unknown post-crash outcomes,
  checks-report failure instead of invented counts, exact HEAD/github.sha and
  eleven source hashes, fresh scratch/upload directories, 16 explicit artifacts
  and 15 manifest entries.
- Push-only fixed branch/job ref-event, contents:read, Node22, 12 minutes,
  no Secrets/environment, no persisted checkout credentials, locked command
  order, seal always, immediate verifier and explicit upload-only paths.

These present structures do not cancel PS001-PS003, and no runtime correctness,
perturbation, actual EOF availability, runner provenance or acceptance is claimed.

## Actual checks and identity

Every Git command used `-c core.fileMode=false`.

Read the current harness/CLAUDE/progress/features/T0, locked binding pair,
early STAGES/plan/scope, original BLOCKED/r1 verdicts and actual new source/test/
workflow, plus the frozen API/worker/guard/trace. Read-only local Git identity,
full name-status/stat and whitespace checks were performed.

A builtins-only offline Node checker, without importing the diagnostic, verified
ten frozen/prior input hashes, four script hashes, the locked six workflow
commands, 16 explicit upload paths, 15 manifest entries, eleven-source set,
all 14 declared control group names, reachable schema-keyword structure and
Coordinator artifact identity. Declared test names are not executed controls.

| Candidate/report file | Bytes | SHA-256 |
|---|---:|---|
| `.github/workflows/windows-p1-stages-diagnostic.yml` | 3103 | `94aa4fa7b31c49dacb71e2643976314351b7a9ad770b51a6e7d982a344bd962b` |
| `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | 72114 | `55d709464b793a578fcf0d6a1a96da0482873ce4d040af8bc671e89d64d686d0` |
| `tests/diagnostics/windows-p1-stages.test.ts` | 43773 | `b7e7dce2ddf532cc25326d802db0eb8ca4c84d71eafd3ecef56bb6023a5f3c50` |
| `verdict.json` | 23876 | `cd8d4e1edcbb69a6702932baba9fd74f9b2b927b6156141cd99b50f5e6be3406` |

`verdict.json` records the complete eleven-source hash set, binding MD, early
input/report hashes, original/r1 report pairs and authorization-artifact hash.
This README hash and the report-only commit/clean final status are delivered
after commit rather than stored as self-referential bytes.

No original 59-file native/log inventory was re-authenticated. Earlier evidence
records real predecessor Windows P1 failure/timeouts; this addition is not a
product fix and cannot close those gates.

## Next boundary

Return these three omissions for narrow repairs in the same approved new CLI/
test paths. Preserve this original report, all old reports and the locked specs.
A new exact candidate needs fresh actual-diff scope review, separately executed
controls, applicable different-model-family functional acceptance, exact-candidate
native evidence and independent Coordinator publication/release authority.

No module import, new or old diagnostic, product/synthetic test, PowerShell,
installation, network, CI, push, source/state/memory change, production action or
`pending_gate.decision` write occurred. Only this report pair is written.
