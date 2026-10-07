# B02 Next 16 / next-intl 4 independent evaluation

- Candidate: `305201ef44ab9e6a6a20f4f24c7c7358d57b1ebe`
- Immediate parent: `4b67b2ec33157b70149d708aebea21d3bd5dbbff`
- Original review baseline: `2074991717abaf3cb34d9aad894bcd4357fefbc3`
- Environment: macOS arm64, Node `22.22.0`, npm `10.9.4`, isolated PostgreSQL 16
- Decision: **B02 migration PASS; production release BLOCKED (`release_ready=false`)**

## Decisive results

| Check | Independent result |
| --- | --- |
| Clean install | PASS, `npm ci` |
| Production audit | PASS: **0 Critical / 0 High / 0 Moderate** |
| Full audit | OPEN: **2 Critical / 10 High / 4 Moderate**, all in dev/build/test chains |
| Verify / lint | PASS; lint 0 warnings |
| Normal + standalone build | PASS |
| Focused tests | PASS, 32/32 |
| Full tests | PASS three times; each 1475 passed / 20 skipped |
| PostgreSQL | PASS, 28 migrations |
| Auth/session/tenant | PASS, two real DB sessions, two tenants, revocation |
| Magic-link callback | PASS with synthetic one-time token; replay rejected |
| Real mail | NOT RUN |
| Chromium | PASS narrow authenticated render + anonymous redirect, using external Evaluator Playwright tooling |
| Standalone runtime | PASS `/login`, providers and CSS; dev-tool roots absent |
| Docker/Linux image | NOT RUN; daemon unavailable |
| Windows/GitHub Actions | NOT RUN |

The production-only audit result closes the first-round nested PostCSS High and next-intl Moderate findings. It must not be restated as a whole-tree zero-vulnerability result. The dev records are absent from `.next/standalone` and the current commands do not expose Vitest UI or a Vite dev server; they are build/CI risk rather than a remote production-server path. They require an owned toolchain migration, especially Vitest/Vite/tinypool, but do not independently invalidate the runtime dependency fix under the verified standalone boundary.

## Why release remains blocked

The exact candidate does not contain B01's required gates. Its deploy workflow does not run lint, PostgreSQL or Playwright and `deploy.needs` includes only Linux `verify`, not Windows. The local evaluator probes show compatibility, but they are not a real GitHub Actions execution on the combined SHA. Linux Docker image behavior, Windows, real Resend delivery and production secret rotation/configuration are also unverified.

## SIGTERM boundary

The evaluator ran three full suites and ten isolated `agent-lifecycle` repetitions with zero failures. The candidate changes no lifecycle implementation or test path. Therefore the defensible conclusion is narrow: no Next 16 regression was observed, and the historical SIGTERM issue belongs to the unchanged B01 process-lifecycle/scheduler boundary. The original pre-handler readiness window is already guarded by waiting for `state.agent.status=running`; this run did not prove a narrower residual cause. A passing retry is not a fix.

See `verdict.json` for the exact release decision and `evidence/` plus `SHA256SUMS` for replay artifacts.
