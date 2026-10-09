# Pre-scope review: BLOCKED

- Role: independent scope critic, not functional Evaluator.
- Exact base: `917b60c99af1f733103e307b41925d858b696bb4`.
- Exact spec commit: `3405031799ec1da5ab1759be325e2041638a3dd8`.
- `scope_violation=false`: the reviewed commit adds only the spec; no implementation drift is present.
- `blocked=true`, `release_ready=false`: the existing positive metadata fixtures conflict with the new mandatory validator relation.

## Decisive contradiction

The spec allows only observability source-pin normalization and old-report stripping, freezing its functional fixtures/assertions (`spec:21-26`). It also requires shape `null` before successful capture, on command failure and overflow, and rejection of inconsistent shape/probe relations (`spec:42-45,70-72`).

The existing test (`tests/ci/vps-host-preflight-observability.test.ts:246-254`) obtains `body=run().body`, replaces **only** `compose_probe`, and requires all five synthetic reports to pass the actual workflow filter. `run()` defaults to retained `v2.35.1`, so the new report must contain a nonnull shape. Its object spread retains that shape for `not_run`, `command_failed`, and `output_bound_exceeded`: all three must fail a conforming new filter. The permitted pin/stripping edits cannot repair this contradiction.

The old `ok/captured_bytes=0` synthetic fixture also needs an explicit shape-only augmentation if byte feasibility is checked. Do not silently add a status/version authenticity restriction that would itself invalidate an immutable legacy positive case. Define exact internal and probe/byte relations; metadata cannot prove the hidden rejected raw string.

Required next step: a separately committed spec revision may authorize **only addition of the new shape field** to these old metadata fixture reports. Freeze old probe values, positive/negative expectations, count, caps, timeouts and rejection vectors. Add separate new inconsistent-shape rejection controls. No validator weakening or unannounced old-test rewrite is permitted. Re-review the new exact spec before implementation.

## Structural reproduction

`contract-compatibility-proof.mjs` reads only the spec and original test blobs from exact commit `3405031799ec1da5ab1759be325e2041638a3dd8`, verifies the exact premises, and returns exit `1` for the three contradictory null-relation cases. This is a static contract-satisfiability check, not candidate functionality evaluation. Original output is retained in `01-contract-proof-original.log`; it must not be replaced by a later successful review.

```sh
node docs/test-reports/BL-COMPOSE-VERSION-SHAPE-20261009/pre-scope/contract-compatibility-proof.mjs
```

## Scope and evidence checked

`git diff --name-status 917b60c... 3405031...` contains only the new spec. Original script/workflow and both existing test blobs are unchanged at this spec commit; blob IDs are in `verdict.json`. Future observability scope-normalization/report-stripping edits are expressly allowed, so this is **not** a claim that no existing diagnostic test will change.

The spec freezes the old regex, capture argv/order, four-key probe, shared `query()`, old outcomes/version fields and 5s/16384/16385 plus 150s/65536 bounds. It prohibits raw/arbitrary strings, paths, secrets, hash output, new host queries, runtime changes and worker push/GH/SSH. Workflow outside the old validator is frozen. These boundaries are narrow, but they do not resolve the executable contradiction above.

Retained actual run `37844242857` has source `9966db19906fbe4b9b7aaeb53ba80e827b383aca`, `refused/compose_unavailable`, `invalid_version`, pipeline `0`, retained bytes `27`, HOME presence `false`; all normal Verify/OCI/Deploy jobs are skipped. The original inventory and completed-run metadata were read locally and left unchanged. The rejected syntax and cause remain unknown. No vendor/distro/HOME/plugin/timeout guess is accepted.

No old functional suite, host script, GH API or SSH operation was executed. No spec/source/test/state/rule/memory file was written. Only this report directory was written; no branch was pushed. Fresh registered Kimi-family exact-source acceptance and independent post-scope review remain required, and neither this review nor its future PASS authorizes production or release.
