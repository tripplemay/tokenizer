# Pre-scope r1: PASS (scope only)

- Exact base: `917b60c99af1f733103e307b41925d858b696bb4`.
- Exact revised spec: `686d3c6b7e9b7c43ba2d999c56d3435668d06352`.
- `scope_violation=false`, `blocked=false`, `release_ready=false`.
- No implementation or functional acceptance is claimed.

## Original contradiction resolved

The new spec (`21-33`) expressly authorizes consistent shape/null additions to the five old synthetic metadata acceptance fixtures. The three null-required statuses can now retain their old positive expectations without carrying the default nonnull shape. The sole old `ok/captured_bytes=0` fixture may change to the accepted version's real byte length; every other old probe value and functional expectation remains frozen. The old impossible combination must be rejected by a new control in the **new** shape test file, preserving the original observability count of 32.

The original `3405031` BLOCKED report, counterexample and exit-1 log remain unchanged under `pre-scope/`. This PASS is a separate adjudication of a different exact spec, not a rewrite of that original failure.

## Implementable, narrow contract

The spec now defines null/object status relations, core/prefix/tail relations, empty-prefix/zero-byte flags, and stricter accepted-version shape/count consistency (`77-88`). Exact keys/types/enums, old allowlists and bounded counts are mechanically checkable without revealing a rejected raw version. Classification of invalid versions is metadata, not proof of hidden raw syntax or cause.

The vendor prefix may be removed only from a local classification candidate (`55-59`). The acceptance input, old regex, probe keys, capture argv/order, shared `query()`, existing outcomes/version fields and every old time/output cap remain frozen. A pure bounded Bash classifier with locally scoped C-locale handling is feasible; no new query or ambient query locale change is needed. Feasibility is not a test-pass claim.

Only the listed observability pins, old-report field stripping and five synthetic acceptance fixtures may change. The original 43 host controls and all other old assertions/fixtures/tests are frozen. Do not claim the old diagnostic test is unchanged: these edits are now explicitly adjudicated. No source or workflow drift outside the declared areas, arbitrary string/path/secret emission, new host query, fallback, HOME restoration, install or runtime mutation is permitted.

## Static evidence and remaining boundary

- Revision `git show --stat`: only the spec, 22 insertions / 6 deletions.
- `git diff --quiet 3405031... 686d3c6... -- scripts/ci/vps-host-preflight.sh .github/workflows/deploy-vps.yml tests progress.json features.json harness-rules.md CLAUDE.md AGENTS.md`: exit 0.
- `git diff --quiet 24e8797... 686d3c6... --` the original `pre-scope/` and host observability evidence directories: exit 0.
- Retained run `37844242857` stays a 27-byte `invalid_version` refusal with pipeline 0 and HOME absent. Its raw format and cause remain unknown.

This independent same-family review is **scope-only**. No host script, old functional suites, GH API, SSH or credential operation was performed. Only `pre-scope-r1/` was written. Implementation still requires independent post-scope review and fresh registered Kimi-family exact-source functional acceptance. Only after those supporting gates may Coordinator publish an exact reviewed non-main ref; every new protected host run needs new actual human approval. No main push, deployment or release is authorized.
