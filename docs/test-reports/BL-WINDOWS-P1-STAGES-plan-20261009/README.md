# P1 staged fixed-marker planning handoff

Supporting Planner, `harness-rules.md` section 1.5. Base `570a16ed75717f8c107b4c99667227cc0c04b0d5`; no state transition. This is a docs-only proposal, not a diagnostic implementation, native result, independent acceptance or release PASS. `release_ready=false`.

## Outcome

- New specification: `docs/specs/BL-WINDOWS-P1-STAGES-20261009.md`.
- Machine-readable proposal: `plan.json` beside this README.
- Initial minimal scope: E0 / old-trace-on / common-guard-on, at most four fresh children: writer-only control, byte-exact original P1 comparator, direct-invoke marker pair, conditional cmdlet lookup pair plus the unchanged JSON invocation.
- Machine-only module discovery and explicit-load pairs are single-operation refinements, not silent initial-scope additions. They need independently reviewed conditional selection and separate approval before the immutable run; at most six total children with no clock/counter reset. No live approval wait or silent second diagnostic is included.
- Original 7 s child, 10 s operation, 600 s total, 40 s case, 3 s cleanup/output allowance, 38/76 launch and output/trace caps remain frozen. P2/downstream never run.

## Key evidence and limitation

Actual run `37822555762` / execution ref `719c2df0d54f62b1b3b3e711a2045ffd8ea5e711` completed ten P0 markers and recorded ten P1 timeouts. It did not capture an internal cmdlet/module/JSON milestone. Independently authored `docs/test-reports/windows-release-diagnosis-20261008/native-parity-findings-r2/` supplies the facts; the current planning pass rechecked all 59 recorded original hashes (121007 bytes), and the frozen source/facts identities are in `plan.json`.

The unchanged bounded worker drops native stdout/stderr when returning timeout. A new fixed-marker script alone cannot preserve partial milestones. The proposal therefore explicitly requires a **new diagnostic-local** stdout guard listener with exact ASCII line/variant/owned-handle validation, immediate enum-only persistence, shared existing caps, separate EOF/stream health, and new strict event/root allowlists. It does not modify the old parity validator, trace preload, product worker, cleanup or product tests.

`Get-Command` can trigger autoload; its bracket cannot prove a pure lookup block. Added discovery/import operations may alter module state inside their own child and are not original autoload parity. Missing after-markers are not proof a function body never ran. Stage arrival timing is not JSON conversion timing. Prefix evidence cannot override unknown trace, provenance or cleanup.

## Validation boundary

This task only read repository rules, progress, Planner guidance, frozen code and the scoped captured artifacts; it created three new docs files. It performed no native CLI run, tests of product behavior, CI submission, GitHub/SSH/network/Secrets/production action, push, or state/memory update. Offline validation of these docs and protected-tree diff is recorded in the local commit handoff, not represented as native acceptance.

Offline planning checks passed: `plan.json` parsing, release/base/launch/marker invariants, exact original P1 script match, all 59 original inventory hashes, all nine source/facts identities, and protected-tree diff against the planning base (exit 0). The observed change inventory contained only the three intended new docs. These are author-side structural checks, not independent approval or execution of the proposed recorder/negative controls.

Required future negative checks include split/coalesced markers, timeout-prefix retention, wrong sequence/variant/child, raw/canary/unknown bytes, EOF/health uncertainty, every unchanged cap/admission boundary, and zero-launch skip decisions. No new intentional native hang/output control is authorized.

## Next step

Approve the initial exact new-file/constant/schema scope, then use a separate Generator and independent scope reviewer. Native publication remains a separately authorized Coordinator action. T4/T5 need another explicit module-refinement gate. Do not choose a product fix, close F005/Windows release gates, widen old timeouts, or start downstream work from this proposal.

Only intended additions:

1. `docs/specs/BL-WINDOWS-P1-STAGES-20261009.md`
2. `docs/test-reports/BL-WINDOWS-P1-STAGES-plan-20261009/plan.json`
3. `docs/test-reports/BL-WINDOWS-P1-STAGES-plan-20261009/README.md`
