# Independent P1 proposal scope review

Reviewed exact source commit `23b9f1183eeb7615a62d1ef222831e5a01d7b558` in `tokenizer-windows-p1-stage-plan-20261009`. Supporting scope critic under `harness-rules.md` section 1.5; not functional acceptance or formal Evaluator signoff.

## Outcome

`scope_violation=false`, `blocked=false`, `issues=[]`: no safety or structural blocker found in the **proposal**. This is not implementation approval, publication authority, evidence that a recorder works, or product PASS. `release_ready=false`, `release_acceptance=false`, `formal_F005_claim=false`.

The plan has not locked the exact new CLI/guard/check/output paths, changed-file allowlist or publication workflow. Those are required before implementation/publication. Their deliberate absence from this proposal is an authority boundary, not a code failure. All future implementation and native checks remain unperformed.

## Decisive review

- **Timeout output loss is real.** `src/cli/bounded-subprocess-worker.mjs:52-57,70` sends only `kind=timeout` after successful cleanup; `src/cli/bounded-subprocess.ts:101` throws. Adding script markers alone cannot preserve prefixes. The new guard-side immediate safe-event log is a coherent way to avoid changing the worker.
- **Owned-handle observation is implementable in principle.** The frozen guard wrapper gets the child before returning it (`native-runtime-parity.mjs:217-247`). Guard-first import precedes old trace's wrapper (`trace-preload.mjs:63-73`), then the worker installs its listeners (`bounded-subprocess-worker.mjs:81-89`). Additive Buffer data listeners can observe the same chunks without consuming/replacing worker/trace listeners. They must not write to worker stdout, alter encoding, call `read`/`pipe`/`destroy`, modify result construction or change cleanup/timers.
- **Safety is explicit, not inferred from token presence.** Spec section 5 requires exact script/case/owned-handle identity, exact ASCII lines and variant order, immediate rebuilt safe enums, bounded buffers/shared byte caps, no raw fallback and new strict schemas. Frozen old validators do not accept these events and must not be widened.
- **EOF/health remain conservative.** The frozen worker destroys streams after forced cleanup (`bounded-subprocess-worker.mjs:43-49`). Close/destroy without observed EOF stays unknown, even with a valid prefix. Any invalid stream, missing guard/trace health, ownership uncertainty, possible-live owned PID or cleanup unknown prevents a complete observation; no marker proves full-tree absence.
- **The minimal initial slice is T0-T3, at most four launches.** T0 is writer control, T1 the unchanged original P1 comparator, T2 only JSON markers and T3 one conditional lookup-or-autoload envelope. A successful T2 or earlier unknown stops refinement. A completed lookup with unresolved invoke does not justify discovery. T4/T5 need separate pre-launch module-scope approval; the conditional six-launch ceiling is not permission. P2/downstream and product repair are excluded.
- **Original bounds and independence remain intact.** E0/old-trace-on/common-guard-on, allowed key names, fresh roots/workers, existing 7s/10s/40s/600s deadlines, 3s allowance, 38/76 launch ceilings and output/log caps stay fixed. No retries, timer renewal, clock/counter reset, second log allowance or arm expansion is permitted. Historical diagnostic SUCCESS and author checks do not replace independent review or release acceptance.

## Evidence checked directly

The three reviewed proposal paths and SHA-256 identities are in `verdict.json`. The source-commit diff against `570a16ed75717f8c107b4c99667227cc0c04b0d5` adds only those three documents.

The r2 findings were treated as claims, not adopted as verdicts. Read the frozen parity CLI, worker, synchronous caller and old trace; independently rechecked all 59 inventory hashes (121007 bytes) and all nine plan-listed source/facts hashes. Directly parsed original native-output records under:

`docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/windows-release-diagnostics-719c2df0d54f62b1b3b3e711a2045ffd8ea5e711/windows-release-diagnosis-20261008/native-output-parity-1791483248698/`

They contain ten completed P0s, ten P1 `BoundedSubprocessTimeoutError` observations, zero P2 calls, five trace-on `ok -> timeout` worker pairs with no P1 stream-byte event, twenty smoke admissions, no selected arm and eight downstream records with `rootProcessStarted=false`. These checks bind downloaded bytes/captured records only; they are not signed remote authenticity, current remote cleanup checks or execution of the proposed recorder.

## Still required

Before any code or publication, separately approve the exact initial new-file/constant/schema scope and review its diff. Check listener ordering and worker protocol preservation, strict EOF/state decisions and shared inclusive caps; the old guard's pre-append size check alone is not proof of a hard log ceiling, so strict overflow suppression and the declared boundary checks must remain effective. Perform the proposed synthetic/mocked negative checks independently. Obtain separate Coordinator non-main publication/native-run authority; no worker push or machine human-gate decision.

No native run, product test, recorder negative-control execution, CI/GitHub/SSH/network/Secrets/production action, push, source/test/workflow edit, original-artifact edit, state transition or memory update was performed. Reviewer additions are only this README and `verdict.json`.
