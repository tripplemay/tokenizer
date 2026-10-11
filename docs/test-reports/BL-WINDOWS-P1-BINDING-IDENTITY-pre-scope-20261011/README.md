# Windows P1 binding identity: fresh supporting pre-scope

**Verdict: PASS_SCOPE_ONLY.** This accepts only the exact proposed C002
four-file static scope. It is not functional Evaluator acceptance, a Generator
handoff, implementation/publication/native authority, an observed Windows fix,
F004/F005 closure or release readiness. No old C001 scope verdict was reused.

Role: fresh supporting critic under harness-rules.md section 1.5. No
progress/features/pending_gate/memory/registry/harness write or state transition.
Review branch: `docs/windows-p1-binding-identity-pre-scope-20261011`.
Review HEAD: `13f750933f9917e147c0df9d930ed043b2ec374f`.
Frozen source221: `221f2f87d94db1656e3000662796d79621b696f5`, tree
`e29bf76487ec8dc7cca5e18392b2eaed3b1c1223`.
Initial worktree was clean; progress remains building / release_ready=false.

## Decisive original evidence

The five actual run38153928452 files were read at the existing parent receipt
directory, independently byte-counted and SHA-256 checked. The four run entries
match the actual transport manifest; the manifest itself was independently
hashed. Its other three publication/list entries were not re-authenticated.
Nothing was copied, normalized or changed. Full paths/sizes/hashes are retained
in verdict.json.

Run 38153928452, attempt 1, job 114512876414, exact source221:

- Checkout and setup-node: success.
- First failure: Prepare exact-candidate provenance,
  `p1-stages.mjs:20:8`, raw JSON binding identity.
- Actual: `481e1496c5342216ff6fba7f3e6e0980395d7ff1b0a2094a595f5b0490659c0e`.
- Expected: `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d`.
- npm ci, synthetic checks and INITIAL: skipped. Seal failed at the same
  import-time assertion; verification/upload skipped; artifacts: 0.

Source `p1-stages.mjs:14-21` reads a Buffer, hashes its raw bytes, asserts one
identity, then parses JSON. Failure precedes prepare(), Windows assertions,
validateBindings(), scratch/provenance creation and INITIAL. Markdown/ten-input
identity checks at lines 76-85 and eleven-source provenance at lines 663-706
were not reached by this run.

Independent pure-memory recomputation from the exact source221 blob:

| Transform | Bytes | SHA-256 | Matches CI actual |
| --- | ---: | --- | --- |
| Unchanged | 34853 | `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d` | No |
| LF to CRLF only | 35072 | `481e1496c5342216ff6fba7f3e6e0980395d7ff1b0a2094a595f5b0490659c0e` | Yes |
| Prepend UTF-8 BOM only | 34856 | `c7809d81afa276c0d88553289d3a0e3c07cac6117903b781de7c72ef9d0719c8` | No |
| Remove final LF only | 34852 | `937eb0694920799cb17f4c833d2163ec9969d39362a0a87b33f74c93b57522ae` | No |

The retained Planner script/capture coherently records one owned local Git
fixture with sixteen files and two checkout-index controls, autocrlf true then
false. All captured false-control hashes match source hashes; its true JSON
matches the CI digest. **The reviewer did not run that script or fixture.**
This is a narrow inference compatible with text conversion, not capture of the
Windows file or observation of Windows autocrlf/config/attribute/filter state.

## Exact C002, not C001 compliance

C001 is frozen revision 2 / count1 / three keys. C002 is a new revision 3 /
count2 / five-key contract:

```yaml
env:
  GIT_CONFIG_COUNT: '2'
  GIT_CONFIG_KEY_0: core.longpaths
  GIT_CONFIG_VALUE_0: 'true'
  GIT_CONFIG_KEY_1: core.autocrlf
  GIT_CONFIG_VALUE_1: 'false'
```

The projected workflow has one env node, owned only by the first checkout@v4
step. Its five values are strings and exactly match JSON workflow.checkout_env.
No workflow/job/later-step/GITHUB_ENV/diagnostic-child propagation is admitted.

The proposed Markdown section 8 explicitly supersedes C001's local exact map
and revision wording for the same four existing paths, while retaining all
other C001/B001/E0 and release restrictions. The original 22275-byte Markdown
prefix is byte-identical; the exact 3179-byte append produces 25454 bytes.

JSON changes only revision, updated_at_utc, revision_scope and
workflow.checkout_env. existing_file_edits_allowed and checkout_env_scope,
all other JSON bytes and all native contracts remain unchanged. Seven literal
replacement targets occur exactly once. CLI contains only two replaced
64-character identity spans; after masking them, every byte equals source221.
The identities derive from revised raw JSON/Markdown bytes, not normalization
or an additional accepted hash.

## Independent in-memory projection hashes

No projected source file was written.

| Path | Bytes | Full SHA-256 |
| --- | ---: | --- |
| `.github/workflows/windows-p1-stages-diagnostic.yml` | 3308 | `df3fb58c31bfbd50eed0b833926b9389d0e60673e4df905f05d883dcb7892e2e` |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json` | 34976 | `f022d586a2968ce67b24512631c7d8ab128d1e85cb483e70934e43d8bfe0a130` |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md` | 25454 | `9ba4ddf4529c0f4ba89fc79a6378e6614c99e62600eee974dd6d57e4a36a6eeb` |
| `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | 73022 | `6548ea1cbf7584873f61b4cb396bc9d4ce8567c672d23313b56a38e8ce0d3bae` |

## Static controls: one positive, 57 rejected counterfactuals

The decisive oracle is **exact complete-byte projection equality**, exact
four-path set and original 100644 modes, plus a restricted structural
AST-shaped read of this workflow and JSON. It is not a generic YAML validator,
Git environment test or functional test. No parsed target expression or
module was evaluated.

Positive: the actual four-file in-memory projection is accepted; workflow and
binding maps agree, six ordered commands and sixteen explicit uploads match
bindings. Each negative below is a single in-memory counterfactual. Its exact
before/after bytes or mode/path mutation and rejection are in verdict.json.

| Group | Cases | Result |
| --- | ---: | --- |
| Workflow and JSON map: wrong count, missing key/value, extra/duplicate key, non-string count/false, wrong first/second key/value | 22 | Reject all |
| Stale revision, extra JSON contract delta, native env allowlist propagation | 3 | Reject all |
| Each config key and all five keys propagated to workflow/job/later step/GITHUB_ENV | 12 | Reject all |
| Persistent config write, sparse checkout, checkout path, new command, permission, Secret, repeat INITIAL, Actions/Node version | 9 | Reject all |
| Stale/one-sided bindingHash/mdHash, extra CLI byte, normalization, second accepted hash | 5 | Reject all |
| Original Markdown rewrite, missing explicit supersession, absent successor append | 3 | Reject all |
| Fifth source file, missing MD, changed source mode | 3 | Reject all |

These controls assess the fixed scope only. They do not prove actual checkout
Git behavior, absence of environment leakage, native byte preservation or
INITIAL behavior. The unchanged original 81-test suite was not run and cannot
be credited as coverage of this new checkout-env contract. Static inspection
of its `exact-source-workflow-and-upload-file-set` block confirms that it checks
commands/ref/uploads and selected workflow text, not this exact env map.

## Frozen records and replay boundary

- Exact git mode/type/object/path inventory: all 2457 source221 entries survive
  unchanged at review HEAD; only the four Planner report files were added.
- Ten frozen inputs independently match current/source221 raw SHA-256 values;
  source221/predecessor888 Git objects are equal for all ten.
- All 57 raw historical archive files under
  `docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/`
  independently hash equal source221 bytes. Their LF-delimited full
  `git ls-tree -r` rows have SHA-256
  `cb15965730dad49aa8d1f138ef0014eff975b96447c93f2e866e9e39721548b3`.
- Original synthetic test: 53608 bytes, SHA-256
  `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`.
- All tests/assertions/rawhash guards, ten inputs, archive/other tracked
  records, API/worker/native env allowlist/E0/B001, eleven-source set,
  sixteen-upload set, selection/caps/budgets/commands, Actions v4 and Node22
  remain unchanged.

Replay this static result from source221's four raw blobs and the exact
SHA-bound Planner capture projection: require each before string once, append
only the specified MD bytes, derive both hashes, replace the two CLI literals,
then compare complete candidate hashes and every unchanged byte. Reject any
other candidate. No retained Planner script, Evaluator tests or diagnostic CLI
needs to be executed.

## Not executed and next gates

No Planner probe/fixture, target runtime/VM/import/npm/tests/diagnostic CLI,
native/PowerShell/live PID/kill, system/global Git config query/write,
network/CI/provider/SSH/DB/keys or running-source edit was performed.
Only passive reads/hashes, pure memory transforms/restricted parsing and these
two new report files were used; the report-only commit is local, never pushed.

1. Separate authority before an isolated Generator applies only this exact
   four-file projection; no worker push.
2. Fresh actual-diff/post-scope plus different-model-family Kimi supporting
   gate; whole-tree/raw-byte proof and originals must survive unchanged.
3. Only a separate Coordinator ruling after those gates may authorize one
   new exact-source locked non-main CI opportunity. No source221 retry or
   automatic follow-up run.
4. Any other key/path/delta, ineffective Windows byte preservation or new
   guard failure: HARD_STOP and return to fresh Planner. Never normalize,
   remove or broaden an assertion.

Compose HARD_STOP/no third Compose and postponed key work remain. No
backup/restore/baseline/password/deployment, new implementation/publication/CI,
main/prod authority or human-gate decision is supplied. Windows/INITIAL,
provider/functionality, F004/F005 and release readiness remain open.

Operational note: the first report-only apply_patch used a relative path and
briefly created these two new reports in the original workspace, not the
isolated worktree. Those mistaken additions were removed with apply_patch;
the reports were then added using absolute isolated-worktree paths. No
source/state/original was touched; the final local commit has only the two
intended report paths.

Before deletion, ls showed the just-created payload sizes (9890/33016 bytes);
no separate SHA-256 of the mistaken-path files was captured. After recovery,
original main is clean at 2074991717abaf3cb34d9aad894bcd4357fefbc3 and the empty
mistaken directory is gone. No pre-task main snapshot is invented.
