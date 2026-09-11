# BL-HOMEPAGE-CODEX-QUOTA — Evaluator Signoff (2026-09-11)

- **Batch:** BL-HOMEPAGE-CODEX-QUOTA · **Fix round:** 0 (first-round verifying)
- **Inspected SHA:** `d6bc7f4e4e565329adb3f08f20aea6df3e8ad7fc` (locked checkout, clean tree)
- **Evaluator:** independent Kimi evaluator, fresh context (Generator was Codex — different model family)
- **Verdict artifact:** `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-verdict.json` (schema-valid, all PASS)

## Results

| Feature | Result | Core evidence |
|---|---|---|
| F001 窗口级 capturedAt | PASS | `src/server/quota.ts:46-101` per-window `capturedAt` via DISTINCT ON (provider, accountKey, windowKey); `tests/server/quota.test.ts` 3/3 in my own run |
| F002 单 Codex 区域 + 折叠 | PASS | One region, latest account expanded, others in one native `<details>` (no `open` attr); legacy/empty/single shapes OK; live UI click + keyboard expansion verified |
| F003 逐窗口 15min/重置失效 | PASS | `getQuotaFreshness`/`getQuotaRemaining` fail-closed; exact 15min and resetsAt==now boundaries probed independently; stale/reset windows show `— 待刷新` with no bar value |
| F004 中英文案 | PASS | en/zh-CN key+placeholder parity; absolute tz-aware reset phrasing; no raw keys/重复“前”/Invalid Date; both locales rendered in browser |
| F005 独立验收与 UI 验证 | PASS | This evaluation itself; see limitations below |

## L1 (all executed by this evaluator, exit codes recorded)

| Command | Exit | Log |
|---|---|---|
| `npm run lint` | 0 (0 warnings/errors) | `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-l1-lint.log` |
| `npm run verify` | 0 (prisma generate + tsc) | `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-l1-verify.log` |
| `npm test` | 0 (102 files passed / 7 skipped; 1353 tests passed / 20 skipped — DB-gated suites skip without DATABASE_URL) | `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-l1-test.log` |
| `npm run build` | 0 (full route table emitted) | `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-l1-build.log` |

Environment gate: `cmp` on `package.json` + `package-lock.json` against `/tmp/tokenizer-quota-evaluator-deps-20260911` both matched; `node_modules` was absent and copied via `cp -cR` from that seed only. No installs, no credentials, no `.env`.

## Independent additions by this evaluator

- `tests/evaluator/bl-homepage-codex-quota-probes.test.ts` — 8 probes, exit 0 (all-unusable-times ordering fallback, future-dated account not promoted, exact 15min/reset boundaries, utilization 0/1, negative credit rejected, i18n hygiene, locale key parity). Log: `BL-HOMEPAGE-CODEX-QUOTA-evaluator-probes.log`. One probe initially failed because my own fixture timestamp was stale (1h old → correctly rendered “Awaiting refresh”); after fixing the fixture to a fresh capture, all 8 pass — product behavior was correct throughout.
- `tests/evaluator/bl-homepage-codex-quota-fixture.test.ts` — generates the F005 UI fixture from the **real** `SubscriptionCard` via SSR + project-compiled `.next/static/css` into `docs/test-cases/bl-homepage-codex-quota-fixture/` (exit 0).

## UI verification (F005, Tabbit task `quota-ui-review`)

Fixture served read-only at `http://127.0.0.1:8797` (server stopped after use; task finished; no unrelated or logged-in tabs touched).

- Desktop 1280px: one `Codex / ChatGPT` region; `<details>` present once, `open=false` initially; summary “Other account snapshots (2)”; collapsed accounts hidden; click expands; focus summary + Enter expands; no horizontal overflow (scrollW == innerW).
- Narrow 375px (en + zh-CN): no overflow before/after expansion (scrollW 375/360 ≤ 375); 70-char account key wraps; zh fully translated （待刷新/重置于/重置时间已过/采集时间未知/其他账号快照（2）), zero raw keys.
- Freshness display: fresh 5h window shows 75% + filled bar; 20-min-stale weekly and reset-passed code-review windows show `— 待刷新` with empty track; fresh credit shows $12.34, stale credit hidden; invalid capture/utilization shows unknown text without NaN.
- Screenshots visually inspected and retained: `docs/test-reports/bl-homepage-codex-quota-ui/{desktop-en-collapsed,desktop-en-expanded,narrow-375-en-expanded,narrow-375-zh-expanded}.png`.

## Explicit non-claims (limitations)

- **Production was NOT deployed** and this evaluation verifies nothing about production.
- The fixture verifies component rendering/interaction only; it does **not** verify production login, the collector/agent pipeline, or the live `/api/quota` data path.
- No L2 performed (`l2_authorized=false`); DB-dependent suites were skipped, not failed.
- Dark-mode visual pass not performed (fixture exercises light theme classes only); dark classes exist in markup but were not browser-verified — cosmetic-only soft-watch.
- Batch stage left unchanged (`progress.json` untouched); no commits, no push.
