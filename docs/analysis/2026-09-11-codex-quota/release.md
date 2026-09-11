# Production release audit

## Authorization and transport

- User explicitly requested commit, push and deployment on 2026-09-11, after approving the repair scope and receiving the independent acceptance results.
- Main integration base: `03351861b49c2858985b10be04b82a31100b78b7`. This pre-existing unpushed verification commit is preserved.
- Production baseline at `2026-09-11T02:02:06.932Z`: health `ok=true`, commit `291810449c5894b66c5d7d613ffe525154fbadf5`.
- Applied the approved worktree's `product.patch` without modification; SHA-256 `35d6a4fee529caa31f569058ee52db08d0914800288a01b8225d7df85626eae3`.
- Accepted hotfix state is archived in `accepted-batch/`; root `progress.json`, `features.json` and `.auto-memory/project-status.md` remain the existing BL-HOMEPAGE-FRESHNESS batch.
- Kimi verdict, signoff, screenshots, fixture and logs were imported unchanged. Historical statements that production was not deployed describe the evaluation time, not the release outcome below.
- No schema, migration, collection protocol, agent capability version or deployment configuration change.

## Main integration checks

Coordinator replay checks supplement, but do not replace, the independent Kimi acceptance at `d6bc7f4e4e565329adb3f08f20aea6df3e8ad7fc`:

| Command | Result | Log under docs/test-reports/ |
| --- | --- | --- |
| `npm run lint` | exit 0, no warnings/errors | BL-HOMEPAGE-CODEX-QUOTA-main-lint.log |
| `npm run verify` | exit 0 | BL-HOMEPAGE-CODEX-QUOTA-main-verify.log |
| `npm test` | exit 0, 1361 passed / 20 skipped | BL-HOMEPAGE-CODEX-QUOTA-main-test.log |
| `npm run build` | exit 0, placeholder DATABASE_URL | BL-HOMEPAGE-CODEX-QUOTA-main-build.log |

Product diff whitespace check passed. Original evidence logs and the embedded patch are preserved byte-for-byte, including their output/context whitespace.

## Release procedure and boundaries

Push main once and follow the matching `Deploy VPS` Actions run. Do not launch a redundant manual deployment. Require Linux Verify and Deploy success, then public `/api/health` with `ok=true` and the exact release SHA. Record Windows independently: the workflow deliberately does not gate Linux deployment on that CLI job.

Unauthenticated health/login checks are not a claim of live authenticated quota or collector verification. The independent acceptance covers real component fixtures, including desktop/narrow-screen expansion and both locales; its dark-mode and live-data limitations remain unchanged. No production data is modified for smoke checks.

## Deployment outcome

- Released commit: `8db58c296bd78a70ec4f75e1c4d4ef2687277f61`, pushed to `origin/main`.
- Actions run: https://github.com/tripplemay/tokenizer/actions/runs/34553333841 (push event, exact release SHA).
- Linux Verify: success, including 1361 passed / 20 skipped and production build.
- Deploy: success. VPS reported 28 existing migrations, no pending migrations, app started, PostgreSQL healthy and local health check OK at `2026-09-11T02:15:11.1654202Z`.
- Public health at `2026-09-11T02:17:06.406Z`: `ok=true`, exact released commit. A second checked response is retained in `release-health.json`.
- Public HTTP smoke: `/login` returned 200; unauthenticated `/` returned 307 to `https://token.vpanel.cc/login`.
- Windows Verify: failure, so the overall workflow conclusion is failure despite successful Linux Verify and Deploy. Three failures are identical to baseline run 32615751636 at production commit `2918104`: SIGTERM lock-release timeout, POSIX installer fixture process visibility, and CRLF-sensitive installer assertion. Relevant CLI/tests/installer files have zero diff between baseline and release. No test was disabled or deployment gate changed.
- Live authenticated UI was not verified: the retained browser tab was on `/login`, and Tabbit resume failed with `PAGE_ATTACHMENT_TIMEOUT`. No credential bypass or production test data was used. HTTP smoke does not substitute for logged-in account validation.

Machine-readable job results and bounded original log extracts are retained alongside this report: `release-actions.json`, `release-health.json`, `release-vps-smoke.txt`, `release-windows-failures.txt` and `baseline-windows-failures.txt`. Extracts preserve original timestamps/ANSI output; the source jobs are 103120857559 (VPS), 103120596006 (Windows release) and 97136072636 (Windows baseline).

The follow-up commit contains only these documentation/audit changes and does not trigger another deployment under the existing workflow path filters. Production should continue to report the product release SHA above, not the later documentation-only HEAD.
