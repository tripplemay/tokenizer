# Post-scope-r1 exact5c5c283: PASS (scope only)

- Source: `5c5c283b08d225b42d8db19abcbe5d3c1f562ac4`; direct parent: `007fd07941bad043025003ed0433ca079801e31d`.
- Spec: `686d3c6b7e9b7c43ba2d999c56d3435668d06352`; base: `917b60c99af1f733103e307b41925d858b696bb4`.
- `scope_violation=false`, `blocked=false`, `release_ready=false`.
- Independent scope critic, **not** functionality/native/production Evaluator.

## Narrow repair verified

The exact repair commit changes only two tests: removes the unauthorized old negative-array entry and its new-test source-pin masking exemption. The mandatory zero-byte rejection remains in the new shape file. The old five acceptance fixtures, expectations and all other test behavior are unchanged from65b10cb; old negative bytes are restored. Runtime/workflow/spec remain byte-identical to65b10cb. The `fix(BL-RELEASE-READINESS-F003)` tag maps to an existing F003 feature; no state file changes.

The final source relative to spec still has only four authorized non-doc paths. Every script byte outside the exact shape additions, workflow byte outside the jq validator, every old validator predicate and every other old test blob remains frozen. The original43 host controls and old32 diagnostic expectations/fixtures/counts/caps/timeouts were not relaxed. Existing diagnostic changes are explicit; this is not a claim that the old file never changed.

## Independent narrow controls: 52 / 52

`scope-controls-r1.mjs` reads the immutable original critic program from007fd079 and adapts only the exact candidate SHA and repaired negative-region expectation **in memory**. It reruns all52 critic source/primitive/filter controls, including34 actual jq cases. Initial output exits0 and is retained in `01-scope-controls-original.json`; provenance is in its stderr file. The original52-control program, original exit1 output and BLOCKED verdict are untouched.

Fixed metadata, synthetic secret/path/code canary absence, byte counting/local locale, forbidden query/regex/bound/ambient mutations and exact shape/null/core/prefix/tail/status/count/flag relations pass these narrow checks. No complete host script or functional suite was executed. A first preservation-inspection comparison incorrectly used65b10cb before the original post-scope report existed and exited1; its exact failure, five differing report paths, diagnosis and corrected007fd079 exit0 are retained in `00-initial-preservation-check.json` rather than erased.

```sh
node docs/test-reports/BL-COMPOSE-VERSION-SHAPE-20261009/post-scope-5c5c283/scope-controls-r1.mjs
```

## Excluded mixed old-tree commit

`7df39aa7b6d5039b75d98a1200502a2c89c23922` is a mixed docs/code commit: mechanical `git show --stat` identifies four dispatch-failure evidence files plus both test repairs. Supplied provenance is that Coordinator's shared index accidentally carried Generator-staged repairs; git content alone does not prove the actor/index cause.

`git merge-base --is-ancestor 7df39aa... 5c5c283...` returns1: it is **not an ancestor** of this candidate. The new source parent is007fd079, and the two test blobs match the isolated repair. The mixed original object remains preserved, not amended or reverted, and is excluded from this source's reviewed publication lineage. It must not be published as the candidate; no remote publication audit or push was performed here.

Only `post-scope-5c5c283/` in the new repair worktree was written/staged. Other agents' docs were not used as acceptance evidence. Fresh registered Kimi-family exactsource functional acceptance and Coordinator publication plus separate actual human protected-host approval remain required. No native/production gate, main push, deployment or release acceptance is granted.
