# Hotfix return package

- User-approved scope: `docs/specs/BL-HOMEPAGE-CODEX-QUOTA-spec.md`.
- Worktree: `/tmp/tokenizer-homepage-codex-quota-20260911`.
- Branch: `codex/homepage-codex-quota-20260911`.
- Feature commits: F001 `4a205b9`, F002 `d00b728`, F003 `4f4a9bd`, F004 `05b00e0`.
- Evaluated source: `d6bc7f4e4e565329adb3f08f20aea6df3e8ad7fc`; later imports contain only tests, evidence and worktree state.
- Kimi receipt: `evaluator-run-meta.json`; unchanged verdict/signoff under `docs/test-reports/BL-HOMEPAGE-CODEX-QUOTA-*`.
- Spec-lock verdict: `spec-lock-verdict.json` (no scope violation; its state-field observation was corrected in `d6bc7f4`).

## Return without disturbing the previous batch

`product.patch` is generated against original main HEAD `03351861b49c2858985b10be04b82a31100b78b7`. It contains product changes and regression tests only; it excludes progress/features/memory and all dispatch metadata. The main workspace's BL-HOMEPAGE-FRESHNESS batch is still verifying and was not modified. Do not blindly cherry-pick the entire hotfix branch over that batch's state.

The orchestrator can inspect and apply the patch after checking its current tree:

```sh
git apply --check /tmp/tokenizer-homepage-codex-quota-20260911/docs/analysis/2026-09-11-codex-quota/product.patch
git apply /tmp/tokenizer-homepage-codex-quota-20260911/docs/analysis/2026-09-11-codex-quota/product.patch
```

Archive the approved spec, independent verdict/signoff, associated logs and UI evidence when integrating. `progress.json` in this branch is local hotfix audit only.

## Verification and boundaries

Kimi independently ran lint/verify/test/build, inspected all five features and performed light-theme desktop/375px en/zh-CN UI checks from real component SSR plus compiled CSS. Its verdicts are all PASS; its original test run was 1353 passed/20 skipped plus eight added probes. After importing the probes, Coordinator integration checks produced lint/verify exit 0 and 1361 passed/20 skipped. This integration check does not replace the independent verdict.

The standalone fixture generator is archived verbatim outside default test discovery because it requires built CSS; see `docs/test-cases/bl-homepage-codex-quota-fixture/README.md`. No evaluator verdict or signoff wording was changed.

No production deployment, push, live authenticated quota verification, collector change, database cleanup, migration or agent capability bump occurred. Dark-mode visual verification remains the evaluator's stated soft-watch. Main pushes can deploy production; only the orchestrator/user may decide integration and release.
