# B02 dependency integration: read-only spot audit

Date: 2026-10-08 Asia/Jakarta. Audited tree:
`79da491ea97579f73136cac28900dfd9abf3ed9a` in
`codex/upgrade-integration-20261008`. This is a technical spot audit, not a
formal Evaluator verdict or a production release signoff. The audited worktree,
main, state machine, and gate were not edited or pushed.

## Result

- The previously open **production** findings are remediated in the installed
  graph: `next@16.4.0`, `next-intl@4.14.9`, `eslint-config-next@16.4.0`, and
  Next's exact nested `postcss@8.5.23`. Live `npm audit --omit=dev --json` on
  this tree returned exit 0 and 0 Critical / 0 High / 0 Moderate. The old
  Next 15 nested PostCSS High and both next-intl 3 Moderate findings are not
  present. Registry `npm view` on this date reports 16.4.0 and 4.14.9 as the
  current Next and next-intl releases. No additional migration is indicated
  for those two packages before this candidate's release gates.
- **Full** `npm audit --json` returned exit 1: 7 High, 0 Moderate, 0 Critical.
  All seven entries are the fan-out of a single `braces <=3.0.3` advisory,
  GHSA-vfj7-8cjw-p6xm: `braces`, `chokidar`, `micromatch`, `fast-glob`,
  `@next/eslint-plugin-next`, `eslint-config-next`, `tailwindcss`. It is
  incorrect to say that the whole dependency tree has a clean scanner report.
- This tree installs the repository-local guarded `braces@3.0.3` via
  `devDependencies.braces=file:vendor/braces` and `overrides.braces=$braces`.
  The lock entry is a local link, and `require.resolve` from the root,
  micromatch, Tailwind, and Next's ESLint plugin all resolve to
  `vendor/braces/index.js`. SHA-256 of all seven files listed in
  `vendor/braces/PATCH-MANIFEST.json.localPatch.modifiedFiles` matches the
  manifest. Focused `npx vitest run tests/vendor/braces-backport.test.ts`
  passed 10/10. The B02 product paths (`package.json`, lockfile, vendor tree,
  focused test) are byte-identical to the cross-family-evaluated
  `b6092cd82f511101f3675c680e36972098b49998` and CI-composed
  `5b34204931a919166d8912716cac21dafea92108` trees (`git diff --name-status`
  empty for those paths). This supports the existing narrow disposition:
  scanner identity/version records remain, while the installed code was
  independently tested against that stack-exhaustion vector. It is **not** a
  blanket finding that all possible `braces` inputs or future versions are
  safe, nor an acceptance of unpatched risk.

## Upstream and recommended next step

The [GitHub advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
still lists no patched release. Live `npm view braces version` returned 3.0.3;
the [upstream guard PR #78](https://github.com/micromatch/braces/pull/78)
remains open. A scanner-zero solution cannot honestly be claimed by bumping
this package today, and `npm audit fix --force`'s suggested breaking toolchain
changes (including an `eslint-config-next` downgrade) are not a security fix.
Keep the exact audited local backport for
this release candidate, treat the 7 High as **documented metadata false
positives for this exact byte tree only**, and fail closed if the vendor files,
lockfile, override, or dependency resolution change. Track a verified upstream
release and replace the backport only after parser and direct-AST walker
negative controls pass. The existing cross-family B02 report and safe-branch
CI prove this slice, but the coordinator must still complete the combined
release, production provenance/recovery, and authenticated F005 gates before
push-main.

For next-intl, the official advisories identify fixes at
[4.9.1](https://github.com/advisories/GHSA-8f24-v5vv-gm5j) and
[4.9.2](https://github.com/advisories/GHSA-4c35-wcg5-mm9h); the installed
4.14.9 is beyond both. The installed Next nested PostCSS version is also no
longer flagged by the live production audit. Existing
`docs/test-reports/B02-security-next16-evaluator-20261007/` covers Next/i18n
build and PostgreSQL/Chromium behavior; this spot audit did not rerun those
runtime cases.

## Replay notes

Commands were run in the audited integration worktree on 2026-10-08
Asia/Jakarta: `git rev-parse HEAD`; `npm audit --json --omit=dev`;
`npm audit --json`; `npm ls next next-intl braces postcss --all --json`;
`npm view next version`; `npm view next-intl version`;
`npm view braces version`; `npx vitest run
tests/vendor/braces-backport.test.ts`; manifest SHA-256 verification with
Node `crypto`; and `git diff --name-status` for the B02 paths against both
evaluated SHAs. This is a lockfile/installed-tree finding at this exact SHA;
re-audit after any composition changes to dependency files.
