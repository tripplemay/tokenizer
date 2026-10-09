# Post-scope exact65b10cb: BLOCKED

- Exact source: `65b10cbe3985d933e88eed6c29e7421748af36fd`.
- Exact spec: `686d3c6b7e9b7c43ba2d999c56d3435668d06352`.
- Exact base: `917b60c99af1f733103e307b41925d858b696bb4`.
- Independent scope critic, **not** functional Evaluator.
- `scope_violation=true`, `blocked=true`, `release_ready=false`.

## Sole blocking finding

`tests/ci/vps-host-preflight-observability.test.ts:268-272` adds `{ ...good, status: 'ok', captured_bytes: 0 }` to the old negative `bad` array. This is outside spec's allowed source-pin, report-stripping and five synthetic **acceptance** fixture regions. It is a strengthening, not a weaker assertion, but strengthening a frozen region is still an unauthorized scope extension.

The mandatory rejection case is already present in the new shape test file. Required narrow fix: in a **new** commit remove only that old-array addition, preserve the new rejection control and all other behavior. Then review the new exact source. Do not rewrite this verdict or its initial failure.

## Mechanical evidence

`scope-controls.mjs` reads the exact git blobs, not mutable working files or Generator narratives. Its initial run returns exit `1`, **51 / 52** critic controls passing; `01-scope-controls-original.json` preserves that first failed result. The only failed control is the old diagnostic exact-authorized-region comparison. Removing only the extra negative entry **in memory** makes the residual byte comparison equal. No source file was edited.

- Exactly four non-doc implementation paths changed. All old tests except the adjudicated observability file are blob-frozen, including original 43 host controls.
- Script outside exact classifier/init/serialization/single-invocation additions is byte-equal to base. Shared query, capture argv/order, regex, refusal and old bounds are unchanged. Synthetic added-query, capture-bound, regex and ambient-locale drifts are detected.
- Workflow outside the existing jq validator is byte-equal; all old validator predicates remain byte-equal after removing only the new root field name and new shape clause. A synthetic transport-bound mutation is detected.
- The classifier uses local C locale and pure shell operations. Its sole fixed-format output has exact nine shape keys and fixed-label/count/Boolean arguments, not retained/candidate/tail values. Critic-owned synthetic path/code canary output stays absent; multibyte byte count and local-locale restoration controls pass.
- All five old positive fixtures preserve old probe values except the explicitly adjudicated real byte count for `ok`; their exit-0 expectations remain unchanged. No old expectations/caps/timeouts/counts were weakened. The extra negative is the sole unauthorized residual.
- 34 independent controls use the actual extracted jq filter. They cover valid shapes/null status relations plus missing/extra/type/enum/core/tail/prefix/status/count/flag and old-allowlist rejection cases. These are narrow **scope validator** checks, not functionality or host acceptance.

## Reproduction and retained boundary

```sh
node docs/test-reports/BL-COMPOSE-VERSION-SHAPE-20261009/post-scope-65b10cb/scope-controls.mjs
```

The exact four-file diff is archived in `02-exact-source-diff.patch`. Original pre-scope BLOCKED, pre-scope-r1 PASS and run37844242857 evidence are untouched. The retained host result remains a 27-byte invalid-version refusal with pipeline0/HOME absent; syntax and cause remain unknown.

Only this report directory was written. Only in-memory mutations, the isolated pure classifier function and the extracted jq filter were executed with critic-owned synthetic values and minimal child environment. No complete host script, old functional suite, real Docker, GH, SSH, native CI, credentials, push or deployment was used. Fresh registered Kimi-family exact-source functionality acceptance and all protected human/publication boundaries remain separate and ungranted.
