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

Post-deployment outcome will be appended after the matching run and public health have been inspected. A subsequent docs-only audit commit does not trigger deployment under the existing workflow path filters.
