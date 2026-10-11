# BL-WINDOWS-P1-PROVENANCE-OBSERVATION-kimi-r0 (OFFLINE supporting evaluation)

Fresh independent Kimi-family evaluator r0 for new provenance-reason source
`62d419b2a419b685542efaaf047b8a749839d493` (parent `10470c1b`, runtime baseline
`712cf210b089dc71f3a6e6ed2e19e1de7fee57da`). Not a source712 retry/supplement;
no previous evaluator results reused. Verdict:
`../BL-WINDOWS-P1-PROVENANCE-OBSERVATION-SUPPORT-verdict.json` (F004 PASS,
offline supporting only).

## Result summary

- Pins re-verified: CLI `p1-stages.mjs` sha256 `411c9e10…760b1` / 77285B / LF-only;
  original 81-test file `7718f1e6…9132`; proposal `f6b28719…5f92` — unchanged after all runs.
- Tree diff vs 712cf210: CLI only (+53/−7, slots S1–S6) + 23 declared doc additions.
- Fresh own `npm ci` (owned HOME/cache/TMPDIR, mandated PATH): exit 0, 670 pkgs,
  registry.npmjs.org only; locked package-owned lifecycle all code 0; `@swc/core`
  package-owned `@swc/wasm@1.16.13` registry fallback read + archived
  (`npm-cache-logs/`); no security claim from exit 0.
- Original 81 diagnostics tests: 81/81 PASS, exit 0 (`evidence/orig81-stdout.log`).
- Own additive stubbed-VM test `tests/evaluator/windows-p1-provenance-observation-r0-support.test.ts`:
  50/50 PASS, exit 0 (`evidence/own-test-stdout.log`). All 18 V00–V17 codes distinguished
  (false vs caught schema/clone vs escaping intervals vs true anomaly vs unknown/nonmember),
  call counts/order/arguments/short-circuit/property reads, both sourceFiles passes,
  unchanged P11 assert, 84=51+29+4 byte accounting (80 for other phases, 51 generic-only,
  0 on success), success reset/silence, non-P11/P12 and other-mode silence, privacy canaries,
  static negative controls. Two earlier harness-side false starts preserved unedited
  (`evidence/own-test-stdout-FIRST-FAIL-preserved.log`, `…-SECOND-FAIL-preserved.log`);
  corrections were test-stub-only (process.versions/env-key stubs satisfying original reads,
  anchor scoping) and never touched the source under test.

## Scope limits

Offline supporting only: not formal F004/F005 acceptance, no native Windows feasibility
claim, no full-release or dependency-security claim, no CI/publication authorization.
Original prepare failure cause remains unknown until a separately approved single
new-source CI. No source/spec/original-test/workflow/state/registry/harness/memory
changes, no commit/push, no pending_gate writes by this evaluator.
