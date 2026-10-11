# Windows P1 checkout proposal: independent pre-scope

**PASS_SCOPE_ONLY. No blocking finding in the exact proposal.** This is a fresh
supporting scope critic under `harness-rules.md` section 1.5, not a functional
Evaluator. It grants no implementation, publication, native execution, environment
repair or release authority. All release/F005 flags remain false; state is untouched.

Reviewed Planner commit: `3d5c249a144a752b276c27058a2ec9f8ef8e5027`.
Source: `888a5acd7a8a441c9ec4ad898453f149cf8d6b7c`, tree
`19186fe317bce76857dc273a9c21b3e940da9e41`.

The isolated worktree was created from that exact Planner commit on
`docs/windows-p1-checkout-scope-20261011`. Source888 -> Planner changes only the two
proposal documents, not implementation. Their SHA-256 values are:

- `proposal.json`: `43468f0252fde60a3eb4c6269e0deeaa841e00f831f19df6225cdfd200da2e7f`
- `README.md`: `7f113da7f1720a42efefc711c433eae8339c8edc4e5aebc37a3bcc839163fcff`

## Decisive evidence

All four run originals were read at their existing parent archive paths and
matched the plan's byte counts and hashes. They were not copied, edited or
reauthenticated as a native result. Run `38145284914`, attempt 1, job
`114487223393`, source888, completed/failure: checkout exit 128, `Filename too long`
at full-log lines 89-90/101. INITIAL was skipped. Seal then failed with
`MODULE_NOT_FOUND` (110/118); verify/upload were skipped and artifact count was 0.
This is first-layer checkout failure evidence, not a PowerShell cause or
whole-process-tree absence proof.

The source tree inventory matches `af29538927397b7ec48c261ca047616d9a18617a65f767165b61105d396d1a23`
(2453 paths). The failed subtree is 55 files, absolute lengths 265-281 at the
logged workspace, hash `6cd55acce1fcd1a225edb9e96c2444c5f3a20f3ae38aaf3a6a2ffa1a78ac902f`.
The enclosing current archive has 57 tracked entries, hash
`52ac3b835b45e6aa3c54ea72f57180421822c5719d2a9e9bca0d2abbbf0a0721`.
These are current git counts, not a replacement for the historical 59-file
runtime inventory. Full original and all 15 source/frozen/prior hashes are in
`verdict.json`.

## Four-file closure independently rendered in memory

No source file was changed or executed. Unique replacement assertions and
independent hashing reproduced all four exact proposed hashes:

| File | Projected SHA-256 |
| --- | --- |
| Workflow | `1ab508fc704fe8ceb1aecbdb9b630ea748add97dc5a17a960940ab4e9a83a771` |
| Binding JSON | `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d` |
| Binding Markdown | `fc7f4d09915d7200177bf0b4d7c6fc76e95e0423d4e1e2f3f2bc3a1986025ec6` |
| CLI, two hash literals only | `3028d77985e965d3de58c965b526bfe6adf7ddebced8b9173c89a5fb6c56e4f6` |

- Workflow: exactly four inserted lines at its sole checkout step. Removing that
  block restores every source byte. The env values are exactly three strings:
  `GIT_CONFIG_COUNT='1'`, `GIT_CONFIG_KEY_0='core.longpaths'`,
  `GIT_CONFIG_VALUE_0='true'`. No workflow/job/later-step env or `GITHUB_ENV` change.
- JSON: exactly the five unique specified substitutions. Restoring revision,
  timestamp, scope, existing-path allowlist and deleting only checkout metadata
  produces the original parsed object. Every other subtree is identical.
- Markdown: prior bytes followed by the exact appendix; it explicitly supersedes
  only the existing-file prohibition for the four exact paths.
- CLI: only the anchored `bindingHash` and `mdHash` 64-character literal values.
  Masking those two literals gives complete source-byte equality. Identity checks
  are not bypassed. New JSON fields are static scope metadata, not new runtime
  validators.

No new implementation path, config persistence, command/probe, retry, sparse/path
rewrite, permission/Secret, archive change, native E0/guard/API/worker/B001 tuple,
quota, schema, test or sourceFiles change is admitted. The sourceFiles list remains
eleven paths and dynamically hashes candidate bytes. Markdown remains independently
identity-checked by `validateBindings`, without adding a twelfth sourceFiles path.

The env chain was statically traced: `runParent` filters the ambient environment
through `systemEnvironment` (894), `runCase` builds fixed E0 (825), `runRoot`
passes that explicit env (767), the preload guard requires exact keys/values
(330-338), and `runProbe` passes that already guarded env (599-605). The three
checkout keys are absent from the admitted five system/22 synthetic key sets.
A reviewer-only in-memory whitelist model retained just `PATH,SystemRoot,WINDIR,
ComSpec,PATHEXT`; this was not execution of the real exported function.

## Static controls, explicitly not functional acceptance

Three reviewer-owned Node stdin scripts completed with exit 0:

1. `PASS_STATIC_RENDER_AND_EVIDENCE`: exact source/tree, proposal-only diff,
   original JSON/log reconciliation and hashes, all 15 inputs, four unique
   projections, byte mask, unchanged JSON subtrees, eleven paths, ten frozen/prior
   inputs, four script hashes and three inventories.
2. `PASS_STATIC_WORKFLOW_SUBSET_AST_AND_FINITE_COUNTEREXAMPLES`: restricted
   indentation parser for this exact fixed YAML subset, preserving string key
   `on` (no YAML 1.1 boolean coercion). Removing only checkout env makes its AST
   equal the source AST, including events/ref, nine ordered steps, checkout inputs,
   permissions, timeout/concurrency and exact 16 upload paths. This is not a
   general-purpose YAML parser or Actions execution.
3. `PASS_STATIC_FOUR_FILE_BYTE_COMPARATOR_COUNTEREXAMPLES`: exact-byte positive
   model and 36 deliberately altered in-memory candidates rejected.

The separate workflow AST equality comparator rejected 65 finite counterexamples:
15 key/count/value/type/extra-pair variants; all 30 copies of each chosen key to
workflow, job or any of eight later steps; four config-write scopes; five added
GITHUB_ENV/version/native-probe/subst commands; and eleven path/sparse/filter/
defaults/permissions/event/ref/Secret/continue-error/retry/upload expansions.
The four-file comparator rejected stale/missing revisions/literals, extra CLI/MD
bytes, each missing JSON substitution, native contract changes, each test/frozen
file mutation and an added implementation path. These are static scope equality
fixtures, not claims that the existing product validator was run against them.
All script errors: none.

The entire unchanged 53,608-byte test source was read. Static declaration expansion
is **81 nominal cases in 14 groups**, per-group counts
`2,2,6,12,2,8,9,2,12,3,3,1,16,3`; group names equal unchanged
`required_future_controls`. This is not 81 newly passing outcomes. Tests 495-503
retain import side-effect checks; 536-550 do not lock the added env map; 552-561
retain declared-control checks. No source-only assertion inspected hardcodes
revision 1, an empty edit allowlist or the old workflow hash. Thus unchanged
tests are necessary later regression evidence but not sufficient env confinement
acceptance. The proposal correctly requires separate supporting checks and does
not change tests/control declarations to manufacture coverage.

## Documented feasibility is not observed Windows repair

The only external reads were the five official URLs already present in the
proposal. Git documents process-runtime config and precedence; Git for Windows
limits long-path support to builtins; GitHub distinguishes step env scope; the
exact observed checkout source copies `process.env` then action overrides, without
the chosen keys; its README places `path` under `GITHUB_WORKSPACE`.
Inference: these support a narrow candidate for the observed checkout layer,
not a demonstrated repair or PowerShell/OS/npm change.

Sources: [Git config environment](https://git-scm.com/docs/git-config/2.55.0#Documentation/git-config.txt-GITCONFIGCOUNT),
[observed Git for Windows core configuration](https://github.com/git-for-windows/git/blob/v2.55.0.windows.5/Documentation/config/core.adoc),
[step env](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsenv),
[exact observed checkout source](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/src/git-command-manager.ts),
[exact observed checkout README](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/README.md).
If a future `v4` resolves differently, inspect it independently; no silent version
upgrade or pinning is authorized.

## Required sequence remains unrun and separately gated

1. Coordinator separately rules on this exact four-path exception before any
   Generator work. This PASS is not that ruling.
2. Generator delivers immutable full candidate SHA C, exact parent/diff/hashes,
   no push. Any extra byte or integration/source change needs fresh exact-source
   actual-diff scope review.
3. A fresh actual-diff critic and separate fresh supporting functional Evaluator
   from a different model family than Generator complete offline Git/env and
   negative controls plus the unchanged scoped suite, preserving full raw outputs
   and original verdict. This critic is not that Evaluator.
4. Coordinator separately obtains explicit non-main publication authority and
   one new exact-C INITIAL workflow opportunity on the already-locked branch.
   No worker push, machine human-gate decision, source888 rerun, automatic retry,
   native environment repair or CI-added config/version probe.
5. Capture new original final/jobs/artifacts/full unshortened log and hashes;
   separately verify `HEAD=C=GITHUB_SHA`, eleven current hashes, scoped-clean
   source, resolved actions and any exact new 16-file sealed observation.
   Earliest checkout/provenance/unknown failure stops without fabricated evidence.

Implementation/publication/execution fields in the plan remain false or null.
Native E0, caps, selection and at-most-four INITIAL admissions stay unchanged.
Checkout success is not INITIAL completeness, native/product acceptance, F005 or
release readiness. Compose HARD_STOP, F004/F005, production/backup and release
gates remain unresolved.

## Replay of the decisive four-file rendering

Run only in this exact source worktree; this reads files, transforms memory and
prints hashes, without imports of product code, file writes or config queries:

```sh
node <<'NODE'
const fs = require('node:fs'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const p = JSON.parse(fs.readFileSync('docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/proposal.json'));
const c = p.contract_revision_required;
const [w,m,j,s] = c.later_generator_allowed_existing_paths;
const old = Object.fromEntries([w,m,j,s].map(x => [x,fs.readFileSync(x,'utf8')]));
const out = {...old};
const once = (t,a,b) => { assert.equal(t.split(a).length-1,1); return t.replace(a,b); };
const d = p.selected_solution.workflow_delta;
out[w] = once(old[w],d.before,d.after);
for (const r of c.binding_json_replacements) out[j] = once(out[j],r.before,r.after);
out[m] += c.binding_md_append;
for (const r of c.cli_identity_replacements) {
  const x = r.constant === 'bindingHash' ? j : m;
  out[s] = once(out[s],`const ${r.constant} = '${r.old}';`,
    `const ${r.constant} = '${hash(out[x])}';`);
}
const mask = t => t.replace(/^(const (?:bindingHash|mdHash) = ')[a-f0-9]{64}(';)/gm,
  '$1'+'0'.repeat(64)+'$2');
assert.equal(mask(old[s]),mask(out[s]));
const hashes = {workflow:hash(out[w]),bindings_json:hash(out[j]),
  bindings_md:hash(out[m]),cli_hash_literals_only:hash(out[s])};
assert.deepEqual(hashes,c.proposed_byte_hashes);
console.log(JSON.stringify(hashes,null,2));
NODE
```

Inventory replay uses `git -c core.fileMode=false ls-tree -rz --full-tree
888a5acd7a8a441c9ec4ad898453f149cf8d6b7c | shasum -a 256`; report-only Planner diff
uses `git -c core.fileMode=false diff --name-status source888 planner3d5c249` with
the full SHAs above. All Git commands in this review used `-c core.fileMode=false`.

Not performed: product imports, VM, suite execution, Git config queries/writes,
offline child-env behavior, install, Windows/native, CI, retries, push, production,
keys or state/gate/registry/memory edits. Only these two new report files are
written via apply_patch. Parent index is untouched. After the local exact-docs
commit and clean/empty index check, this supporting critic stops.
