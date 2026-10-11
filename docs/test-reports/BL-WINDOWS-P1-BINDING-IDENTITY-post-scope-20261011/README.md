# Windows P1 C002: fresh supporting actual-diff / post-scope

**Verdict: PASS_SCOPE_ONLY. Blocking findings: none within this exact static
scope.** This is not functional Evaluator acceptance, proof of a Windows fix,
Generator/Coordinator authority, native execution/publication permission,
F004/F005 closure or release readiness. No old C001 scope PASS or pre-scope
PASS was borrowed as actual-diff acceptance.

Role: fresh supporting critic under harness-rules.md section 1.5.
Review branch: `docs/windows-p1-binding-identity-post-scope-20261011`.
Reviewed source: `61cf64e67a6fda231bb090e77c19d5ececb908af`.
Exact parent: `88d07004466251be3076fc454699207d3879374f`.
Runtime evidence baseline source221: `221f2f87d94db1656e3000662796d79621b696f5`.
Candidate tree: `f83ae75d895dbd2f784eeb6992d8471dc6e562d8`.
Initial worktree: clean. Progress read: building / release_ready=false.
Only this README and adjacent verdict.json are new local report outputs;
no state/features/pending_gate/memory/registry/harness write or push.

## Actual source delta, not a proposed-only projection

The Planner13f7509 proposal/capture and pre-scope88d070 reports were read as
claims, then checked independently against immutable source blobs, current
working bytes, actual commit trees and original CI receipts.

Source61 versus parent88 changes **exactly four existing 100644 blob paths**,
with no addition/deletion or mode/type change. Source221 versus source61 has
the same four source changes plus precisely the six existing Planner/pre-scope
report additions. Those six report objects equal parent88.

The seven replacement targets occur once each. Independently applying their
exact before/after strings and exact Markdown append from the SHA-bound
`probes.raw.json#/projection` in memory reproduces all actual source61 blobs.
Each actual working file equals its committed blob and the independent
projection, with these full identities:

| Actual source61 file | Bytes | SHA-256 |
| --- | ---: | --- |
| `.github/workflows/windows-p1-stages-diagnostic.yml` | 3308 | `df3fb58c31bfbd50eed0b833926b9389d0e60673e4df905f05d883dcb7892e2e` |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json` | 34976 | `f022d586a2968ce67b24512631c7d8ab128d1e85cb483e70934e43d8bfe0a130` |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md` | 25454 | `9ba4ddf4529c0f4ba89fc79a6378e6614c99e62600eee974dd6d57e4a36a6eeb` |
| `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | 73022 | `6548ea1cbf7584873f61b4cb396bc9d4ce8567c672d23313b56a38e8ce0d3bae` |

Exact replayable patch command:
`git -c core.fileMode=false diff --no-ext-diff --binary 88d07004466251be3076fc454699207d3879374f 61cf64e67a6fda231bb090e77c19d5ececb908af`.
Its raw stdout is 9430 bytes, SHA-256
`933b428ac2f08db683da0375f3bef8a841c8d7e23c85b2e5871aebd837640907`.
The report does not modify/copy any original receipt.

### C002 contract and checkout confinement

C001 revision2/count1/three-key was the frozen long-path fix. C002 is a **new**
revision3/count2/five-key contract. Actual Markdown section 8 explicitly
supersedes only C001's exact map and revision wording for the same four paths;
all other C001/B001/E0 and release restrictions remain.

```yaml
env:
  GIT_CONFIG_COUNT: '2'
  GIT_CONFIG_KEY_0: core.longpaths
  GIT_CONFIG_VALUE_0: 'true'
  GIT_CONFIG_KEY_1: core.autocrlf
  GIT_CONFIG_VALUE_1: 'false'
```

A restricted literal structural read of the actual workflow finds exactly one
env node, belonging only to the first checkout@v4 step. All five values are
strings; its two Git config pairs are longpaths=true and autocrlf=false. The
map exactly equals JSON workflow.checkout_env. No workflow/job/later-step/
GITHUB_ENV/diagnostic-child propagation is admitted. This is a static
confinement finding, **not** proof of checkout subprocess behavior or absence
of native environment leakage.

- Workflow: only count1 -> count2 and KEY_1/VALUE_1 additions.
- JSON: only revision, updated_at_utc, revision_scope and checkout_env; every
  other raw byte and contract, including checkout_env_scope, remains.
- Markdown: original 22275-byte prefix is unchanged, plus only the exact
  3179-byte append (SHA-256
  `db9b5ea07088e44774351a02cb56d9c3277ca368b2f98a95ec931598f4b81377`).
- CLI: only the two derived 64-character bindingHash/mdHash literals. After
  masking those two spans, **every byte** equals source221. Raw Buffer hash
  assertions, single accepted identities and all later guards remain;
  there is no normalization or second accepted digest.

Six ordered commands and sixteen ordered explicit uploads equal JSON
bindings. The eleven-path sourceFiles set, ref, permissions, Secrets,
Actions v4, Node22, API/worker, B001/E0/native env allowlist, selections,
caps/budgets, tests and required_future_controls are unchanged bytes/contracts.

## Whole-tree and original-record preservation

- Source221 inventory: 2457 mode/type/object/path rows. Exactly 2453
  non-exception rows remain identical; four exception rows retain mode/type.
- Candidate source61: 2463 tracked entries. All raw working bytes and types
  were checked against committed objects, including symlink handling.
  Mismatches: **0**. The only six additions are the untouched plan/pre-scope
  reports; there is no fifth source edit.
- Ten frozen inputs independently match raw SHA-256 and bytes in source221,
  predecessor888, source61 and this worktree. Full paths/hashes are in JSON.
- All 57 historical raw archive files under
  `docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/`
  independently equal source221/current candidate bytes. Their LF-delimited
  source `git ls-tree -r` rows have SHA-256
  `cb15965730dad49aa8d1f138ef0014eff975b96447c93f2e866e9e39721548b3`.
- Original test: 53608 bytes, SHA-256
  `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`,
  unchanged and **not run**.

The unchanged test source at lines 506-551 covers selected workflow text,
commands/ref/uploads, but does not freeze this exact checkout env map.
Neither its old 81-test result nor any synthetic suite is counted as C002
checkout confinement coverage.

## Independent static controls

**Positive:** actual source61 four-file candidate and actual workflow accepted.
**Negative:** 70 independent one-variable memory counterfactuals rejected.

The decisive scope oracle is exact complete-byte projection equality, the
closed four-path set and original 100644 modes, supplemented by restricted
workflow/map shape and CLI hash-mask checks. This is not a generic YAML
validator, imported product validator, runtime test or native env test.
All mutation before/after strings or path/mode deltas and mutated digests
are retained in verdict.json for replay.

| Counterfactual group | Cases | Result |
| --- | ---: | --- |
| map | 18 | REJECT all |
| binding-map | 10 | REJECT all |
| binding-contract | 2 | REJECT all |
| confinement | 20 | REJECT all |
| forbidden-surface | 9 | REJECT all |
| identity | 5 | REJECT all |
| MD | 3 | REJECT all |
| closed-path/mode | 3 | REJECT all |

Coverage includes missing/extra/duplicate/non-string/wrong count/key/value
and second pair, each of all five keys propagated separately to workflow,
job, later step and GITHUB_ENV, native child env expansion, config writes,
sparse/path changes, new commands, Secrets/permissions/retry/version changes,
one-sided stale hashes, normalization/second digest, extra CLI byte,
Markdown prefix rewrite/missing supersession/append and fifth/missing/mode
source changes. These reject scope broadening only; no target validator or
functional/native behavior was exercised.

## Preserved native failure and evidence boundary

The actual existing five receipts at the parent coordination directory were
independently byte-counted and SHA-256 checked. Four run entries match the
actual transport manifest; the manifest itself was hashed. Its other three
publication/list entries were not re-authenticated.

| Original receipt | Bytes | SHA-256 |
| --- | ---: | --- |
| `windows-checkout-native-run38153928452-final-original.json` | 12289 | `3405b586c018591761432b9af713c16ce4d01aafd30cec429fec2391a9e0bafd` |
| `windows-checkout-native-run38153928452-jobs-original.json` | 3116 | `60e2e1486a62afd778af32b8cc5a2ab5c37ce942ea227a72de32fb01412c554d` |
| `windows-checkout-native-run38153928452-artifacts-original.json` | 32 | `244563f989470892c537c9a4622920af0d228ee4528f7d00c64a06d6cd95856c` |
| `windows-checkout-native-run38153928452-full-original.log` | 25522 | `e59bc74666038fe982cdcacf64e8cbc398f43bd42d9795e7c54fb272542141d4` |
| `windows-checkout-native-run38153928452-transport-manifest.json` | 1564 | `1410006509d2f41ad9865223b42beda72d026d04e6538b1f76da86a2e5387961` |

Receipt directory:
`/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008/docs/test-reports/BL-RELEASE-READINESS-coordination-20261011`.

Run **38153928452**, attempt **1**, job **114512876414**, source221 remains
completed/failure:

- Checkout and setup-node succeeded.
- Prepare failed at module-top-level `p1-stages.mjs:20:8`, raw JSON binding
  identity. Actual
  `481e1496c5342216ff6fba7f3e6e0980395d7ff1b0a2094a595f5b0490659c0e`;
  expected
  `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d`.
- npm ci, synthetic checks and INITIAL were skipped. Seal failed at the same
  import-time assertion. Verification/upload skipped; **0 artifacts**.

Source lines 14-21 read a Buffer, hash its raw bytes, assert identity, then
parse JSON. Failure preceded prepare(), Windows checks, validateBindings(),
scratch/provenance and INITIAL. Markdown/ten-input checks at 76-85 and
eleven-source provenance/HEAD/scoped-clean checks at 663-706 were not reached.

Independent pure-memory LF -> CRLF transformation of source221 JSON gives
35072 bytes and exactly the observed old actual digest. BOM-only and final-LF
removal do not. The retained Planner source/capture coherently records sixteen
files and two owned local fixture controls; it was **not executed or replayed**.

This is only an inference consistent with checkout text conversion. It does
not observe Windows file bytes, autocrlf/config source, attributes/filters, or
prove C002 native byte preservation. No new Windows/INITIAL observation exists.

## Execution limits and pending gates

No Planner probe/fixture, target module import/VM/runtime, product validator,
old/new diagnostic CLI, tests/npm/dependencies, native/PowerShell/PID/kill,
system/global Git config query/write, network/new CI/provider/SSH/DB/keys,
backup/restore/baseline/password/deployment or push was executed.
Reads, hashes, git-object inventory and transient builtins-only static
inspection/pure-memory transforms were used. Every git command used
`-c core.fileMode=false`. Inspection Node25 is not candidate Node22 execution.

One initial transient inspector construction failed before any inspection:
Node v25.7.0 SyntaxError / Unterminated string constant. JavaScript
String.replace's dollar-apostrophe replacement metasequence corrupted the
Secret counterfactual literal in the in-memory script. Only that reviewer
script literal was corrected; full static inspection then completed once.
No file/target module/test was involved. This failure is retained, not hidden.

Still required, **not authorized by this report**:

1. Different-model-family **Kimi supporting gate**; this supporting scope
   critic is not the functional Evaluator and cannot satisfy that gate.
2. Separate **Coordinator ruling** before one new exact-source locked
   non-main CI opportunity; no source221 retry or automatic follow-up run.
3. Native Windows byte preservation and every later INITIAL/native/
   functional/provider/F004/F005/release gate remain unverified.
4. Any other key/path/delta, ineffective native preservation or new guard
   failure: HARD_STOP and return to fresh Planner. Never normalize/remove/
   broaden a guard.

Compose **HARD_STOP / no third Compose** remains. User-postponed key work
and no backup/restore/baseline/password/main/prod/deployment remain unchanged.
No pending_gate decision, state transition, main push or release acceptance.
