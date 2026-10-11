# Windows P1 binding identity: supporting Planner proposal

**Outcome: propose C002; fresh pre-scope is still required.** This is evidence
localization and a minimal follow-up option, not implementation, functional
acceptance, native execution authority or release readiness.

Frozen source221: `221f2f87d94db1656e3000662796d79621b696f5`, tree
`e29bf76487ec8dc7cca5e18392b2eaed3b1c1223`. Predecessor888:
`888a5acd7a8a441c9ec4ad898453f149cf8d6b7c`, tree
`19186fe317bce76857dc273a9c21b3e940da9e41`.
Own branch: `docs/windows-p1-binding-identity-plan-20261011`.

## What was observed

- Immutable run **38153928452**, attempt **1**, job **114512876414**, exact
  source221: completed/failure. Checkout and setup-node succeeded.
- First failure: `Prepare exact-candidate provenance`, module-top-level
  `p1-stages.mjs:20:8`, **raw JSON binding identity**. `npm ci`, synthetic checks
  and INITIAL were skipped. Seal failed at the same import-time assertion;
  verification/upload skipped; **0 artifacts**. There is no executed 81-test
  result or INITIAL observation from this run.
- Log-observed Git `2.55.0.windows.5`, Node `22.23.3`, npm `10.9.9`; checkout@v4
  resolved to `11d5960a326750d5838078e36cf38b85af677262`; workspace
  `D:\a\tokenizer\tokenizer`. None establishes native PowerShell version.

The four raw CI receipts were independently hashed and matched their size/hash
entries in the supplied transport manifest. The manifest was itself hashed;
its three other publication/list entries were not re-authenticated. No original
bytes, including raw log trailing whitespace, were changed or duplicated.
`proposal.json.original_receipts` holds all five paths, sizes and full SHA-256.

## Narrow recalculation, not runner-state observation

| JSON candidate | Bytes | SHA-256 / relation |
| --- | ---: | --- |
| Raw source221, 219 LF, 0 CR, no BOM | 34853 | `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d` = expected |
| Only LF to CRLF | 35072 | `481e1496c5342216ff6fba7f3e6e0980395d7ff1b0a2094a595f5b0490659c0e` = CI actual |
| Only prepend UTF-8 BOM | 34856 | Does not match CI actual |
| Only remove final LF | 34852 | Does not match CI actual |

One disposable **local Git** fixture contained 16 exact source221 blobs:
the four proposed edit paths, unchanged synthetic test, tracked `.gitattributes`,
three prior inputs and seven frozen runtime inputs. `core.longpaths=true` was
held constant; command-scope `core.autocrlf=true` reproduced the CI JSON digest.
Changing only that value to `false` preserved all 16 raw source blobs. Its
HOME/TMP/XDG/globalGit paths belong to
`/Volumes/ORICO/project/.wp1cb-plan-20261011`; no real global/system Git config
was queried or modified. No diagnostic/test module was imported or executed.

This supports checkout text conversion as a **narrow inference**. It does not
capture the Windows JSON bytes or observe Windows autocrlf/config provenance,
global/system/info attributes or filters. The tracked tree contains only root
`.gitattributes`; `/docs/test-reports/**` is `-text`, while the spec bindings are
not covered. Local fixture behavior is not Windows acceptance.

## Earliest decisive boundary

`p1-stages.mjs` lines 14-21 read a Buffer, hash its **raw bytes**, assert the
single `bindingHash`, then parse JSON. Failure precedes `prepare()`, Windows
runner checks, `validateBindings()`, scratch/provenance creation and INITIAL.
The unchanged Markdown/raw frozen-input checks (lines 76-85), HEAD/scoped-clean
source check and eleven-source provenance (lines 663-706) were not reached.
All ten referenced hashes independently match source221/source888/current
working bytes; this is static source evidence, not proof of Windows copies.

## Minimal option: a new C002, not old C001 compliance

**Current C001 is already frozen:** revision 2, exactly count1/three keys,
checkout-only `core.longpaths=true`. Adding a second config pair cannot be
described as satisfying that old exact contract.

Propose revision 3 / C002, confined to checkout action step and its Git
subprocess command scope:

```yaml
env:
  GIT_CONFIG_COUNT: '2'
  GIT_CONFIG_KEY_0: core.longpaths
  GIT_CONFIG_VALUE_0: 'true'
  GIT_CONFIG_KEY_1: core.autocrlf
  GIT_CONFIG_VALUE_1: 'false'
```

Prevent checkout conversion; **do not normalize hash input**, accept another
digest, remove an assertion, write config, add commands or change versions.

The exact in-memory four-file projection is SHA-bound in
`probes.raw.json.projection` (exact before/after strings and Markdown append):

1. Workflow: count1 to count2, add exactly KEY_1/VALUE_1 inside checkout env.
2. JSON: only revision, updated timestamp, C002 revision_scope and checkout_env.
3. Markdown: append exact section 8; preserve all prior bytes, explicitly
   superseding the old count1/three-key restriction solely for C002.
4. CLI: **only** two 64-character identity literals. New `bindingHash` =
   `f022d586a2968ce67b24512631c7d8ab128d1e85cb483e70934e43d8bfe0a130`;
   new `mdHash` =
   `9ba4ddf4529c0f4ba89fc79a6378e6614c99e62600eee974dd6d57e4a36a6eeb`.
   After masking those literals, every CLI byte equals source221.

All four candidate sizes/hashes are in `proposal.json`. Nothing projected was
written. No `.gitattributes`, test/assertion, normalization/hash guard, B001/E0,
native env allowlist, API/worker, selection, caps/bounds, commands, source set,
upload/archive/permissions/Secrets or retry change is proposed. Public Actions
remain v4, Node remains 22. All other tracked file bytes/modes and original
historical inventories must survive future actual-diff review unchanged.

## Required next gates, all pending

1. **Fresh supporting pre-scope** on this C002 contract and exact projection.
2. **Generator** applies only the approved four-file projection in isolation.
3. **Fresh actual-diff/post-scope** and **different-model-family Kimi supporting
   gate**. Positive/negative confinement controls must reject wrong count/key/
   value, extra keys, env propagation, stale/one-sided hashes, any extra CLI byte
   or fifth source edit. Do not alter original tests or manufacture env coverage
   from the unchanged synthetic suite.
4. Only then, and with a separate ruling, **Coordinator** may publish one new
   exact source on the locked non-main branch and permit one CI opportunity.
   No source221 retry or automatic follow-up run is authorized by this report.

If another key/path/delta is needed, return to Planner and stop; do not broaden.
Windows byte preservation and all later INITIAL/native/functional/release gates
remain unverified. Compose **HARD_STOP / no third Compose** remains. Keys are
user-postponed: no backup/restore/baseline/password/deployment. F004/F005 and
`release_ready=false` remain open. No new native/publication authority is given.

## Minimal retained probes and operational boundary

- `probe.mjs`: builtins-only reads, Buffer transforms, one owned Git fixture and
  in-memory projection. SHA-256:
  `58ac7237c757bee331017a7dc1065ae85931115d20be331c381b36a5aefd25e1`.
- `probes.raw.json`: captured output, exact edit strings, source/original hashes
  and every Git command result; 72541 bytes, SHA-256:
  `d445ff00e28ed8529234264559df3128e9b1be81dc5856ea7cf5579a8af502f4`.

The probe was run once with `node <this-report>/probe.mjs`; it intentionally
rejects reused fixture/capture paths. Preserve this capture when replaying:
use a separately named owned fixture/capture, never rerun the native diagnostic
CLI or import an existing Evaluator test. No network/npm/CI/SSH/DB/configstore,
PowerShell/live PID/kill, state/memory/registry/harness write or push occurred.

One report patch briefly mis-targeted an empty README at the own worktree root;
that accidental documentation change was immediately restored **using
apply_patch from exact source221**, with `git diff --exit-code -- README.md = 0`.
No running source or CI original was changed. Final diff/commit is confined to
the four new report paths; no state transition or self-evaluation is claimed.
