# Windows P1 checkout: fresh actual-diff supporting scope

**PASS_SCOPE_ONLY; findings: none.** This fresh critic uses `harness-rules.md`
section 1.5 and is not the functional Evaluator. It supplies no publication,
native execution, environment repair, product/F005 or release authority. State,
gates, registries, memories, parent/Generator indexes and production are untouched.

- Exact source: `221f2f87d94db1656e3000662796d79621b696f5`.
- Single parent: `54af183617ed06c18edd42632326dbfd09451456`.
- Original failure baseline: `888a5acd7a8a441c9ec4ad898453f149cf8d6b7c`.
- Source tree: `e29bf76487ec8dc7cca5e18392b2eaed3b1c1223`.
- Own worktree: `/Volumes/ORICO/project/.worktrees/tokenizer-windows-p1-checkout-post-scope-20261011`.
- Own branch: `docs/windows-p1-checkout-post-scope-20261011`.

## Actual four-file closure

Read the committed source and own disk files independently, not Generator claims.
Re-rendered source888 with the locked proposal's exact byte substitutions and
compared every actual byte. All four actual SHA-256 values equal the proposal and
the fixed Coordinator ruling at `77b00b16e5490db4bd2f860209d8e30b601cb2c4`.

| Actual file | SHA-256 | Admitted delta |
| --- | --- | --- |
| `.github/workflows/windows-p1-stages-diagnostic.yml` | `1ab508fc704fe8ceb1aecbdb9b630ea748add97dc5a17a960940ab4e9a83a771` | Exactly 4 added checkout env lines |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json` | `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d` | Exactly 5 unique substitutions |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md` | `fc7f4d09915d7200177bf0b4d7c6fc76e95e0423d4e1e2f3f2bc3a1986025ec6` | Exact 3011-byte appendix; prior 19264 bytes identical |
| `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | `3028d77985e965d3de58c965b526bfe6adf7ddebced8b9173c89a5fb6c56e4f6` | Only `bindingHash` and `mdHash` literals |

Masking precisely the two anchored 64-character CLI literal values yields all
73,022 baseline bytes identically; masked hash
`61cbff31435d617ac2dd0cd26186407bb42695c02207cd90aab1df99845322d7`.
Module-load JSON identity and independent Markdown identity remain strict.
Restoring only the admitted JSON metadata makes the complete parsed binding
object identical to source888, including schemas, B001/API/native tuples, E0,
guards, worker, bounds, selection, output/upload and start-once contracts.

The exact 10 prior/frozen hashes, four script hashes and 11 current sourceFiles
hashes were independently recomputed and are listed in `verdict.json`. No twelfth
Markdown sourceFiles path was added; its separate identity check remains intact.
The unchanged 53,608-byte test source was read and declarations statically
expanded to **81 nominal cases in 14 unchanged required groups**: counts
`2,2,6,12,2,8,9,2,12,3,3,1,16,3`. These are not 81 new passing outcomes.
The existing workflow assertions do not lock checkout env; separate confinement
acceptance remains necessary. No suite/import/VM was executed or manufactured.

## Whole-tree and archive preservation

NUL-delimited `ls-tree -rz --full-tree` mode/type/path/blob records show:

- Parent54af -> source221: only the four source paths above differ.
- Source888 -> source221: only those four plus the four already-declared
  plan/pre-scope report additions differ. The latter remain byte-identical to
  parent54af. All other records, tests, fixtures and frozen files are identical.
- 2453 baseline records, 2457 parent/source records. Source inventory SHA-256:
  `7f88d742ab78cf03b55a5fade7c899e83a9caa04218abfb444f8ad702274a06e`.
- The original enclosing archive has all 57 tracked records unchanged, inventory
  `52ac3b835b45e6aa3c54ea72f57180421822c5719d2a9e9bca0d2abbbf0a0721`.
  Its 55-file failed subtree also remains identical,
  `6cd55acce1fcd1a225edb9e96c2444c5f3a20f3ae38aaf3a6a2ffa1a78ac902f`.

These git counts do not replace or reauthenticate the historical 59-file runtime
inventory. No archive was shortened, omitted, moved, deleted or rewritten.

## Step confinement and reviewer-owned static counterexamples

The actual checkout step has only the three string values `GIT_CONFIG_COUNT=1`,
`GIT_CONFIG_KEY_0=core.longpaths`, `GIT_CONFIG_VALUE_0=true`. A fresh restricted
fixed-workflow YAML parser preserves string `on`, scalar types, nine ordered
steps and 16 explicit upload paths. Removing only checkout env makes the entire
AST equal source888. This is not a general YAML parser or an Actions execution.

Three independent reviewer-owned Node stdin scripts completed with exit 0:

1. `PASS_STATIC_ACTUAL_DIFF_AND_IMMUTABLE_EVIDENCE`: exact parent, byte projection,
   locked report/ruling/original hashes, complete tree records, frozen inputs,
   four scripts, 11 dynamic hashes and static declaration recount.
2. `PASS_STATIC_FIXED_WORKFLOW_AST_AND_65_FINITE_COUNTEREXAMPLES`: positive AST
   comparison; 65 altered AST candidates rejected: 15 env absence/value/count/type/
   extra-pair changes, 30 copies of the chosen keys to workflow/job/eight later
   steps, four persistent config scopes, five added GITHUB_ENV/version/native/
   subst shell commands, 11 path/sparse/filter/defaults/permission/event/ref/
   Secret/continue-error/retry/upload expansions. Four additional raw-YAML
   negatives were rejected; one duplicate key failed at the parser boundary.
3. `PASS_STATIC_FOUR_FILE_BYTE_MODEL_AND_36_FINITE_COUNTEREXAMPLES`: exact-byte
   positive; nine unrevised/stale/extra-byte/prior-MD mutations, each of five
   missing JSON substitutions, ten contract-subtree mutations, tests plus each
   of ten frozen/prior file mutations, and one added implementation path rejected.

No new global/system/local/worktree config write, GITHUB_ENV, extra shell/version
probe, permission, Secret, retry, short-path or sparse checkout is present.
Unchanged runtime source statically traces `runParent` (894) whitelist ->
`runCase` (825) fixed E0 -> `runRoot` (767) explicit env -> strict preload
`guardConfiguration` (330-338) -> `runProbe` (599-605) guarded native env.
The three checkout keys are outside five system and 22 synthetic admitted keys.
A reviewer-only whitelist data model discarded all three names and lowercase
variants, retaining only `PATH,SystemRoot,WINDIR,ComSpec,PATHEXT`. Thus no new
checkout-key native propagation path is introduced in this static source model.
Actual child environment and Git command-scope behavior remain unexecuted;
these static comparators do not prove product validators or Windows behavior.

## Original failure and error transparency

Read and hashed all four originals directly from fixed parent evidence commit77,
not from a new network request or Generator report. Run `38145284914`, attempt 1,
job `114487223393`, source888 remains completed/failure: checkout exit 128,
`Filename too long` at full-log lines 89-90/101. INITIAL was skipped; always-seal
then failed with `MODULE_NOT_FOUND` at line 118. Original artifact count is 0.
The original log remains 18,378 bytes/137 lines and all four original hashes
match the locked proposal. Nothing was copied, changed or reauthenticated.
This is checkout-layer failure, not a PowerShell cause, sealed native observation
or whole-process-tree absence proof. It is not overwritten by this scope PASS.

Original pre-scope `static_counterexamples.errors=[]` remains unchanged. All
three current static scripts had no errors. One earlier read-only `rg` returned
exit 2 because the coordination directory is absent from source221:

```text
rg: docs/test-reports/BL-RELEASE-READINESS-coordination-20261011: No such file or directory (os error 2)
```

Recovery used only `git show` of fixed `77b00b1`. This input-location lookup error
is retained here and in verdict, not converted into a product finding or hidden.

## Replay: exact source/projection comparison

Run in this report worktree. Reads fixed git blobs and files, transforms only
in-memory byte strings; no product import, config query/write, installation or
network. The report commit is not a new execution source.

```sh
node <<'NODE'
const fs = require('node:fs'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const S = '221f2f87d94db1656e3000662796d79621b696f5';
const P = '54af183617ed06c18edd42632326dbfd09451456';
const B = '888a5acd7a8a441c9ec4ad898453f149cf8d6b7c';
const git = (...a) => cp.execFileSync('git', ['-c', 'core.fileMode=false', ...a]);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const p = JSON.parse(fs.readFileSync('docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/proposal.json'));
const c = p.contract_revision_required, [w,m,j,s] = c.later_generator_allowed_existing_paths;
assert.equal(git('show', '-s', '--format=%P', S).toString().trim(), P);
const old = Object.fromEntries([w,m,j,s].map(x => [x,git('show', B+':'+x).toString()]));
const out = {...old};
const once = (t,a,b) => { assert.equal(t.split(a).length-1,1); return t.replace(a,b); };
out[w] = once(out[w],p.selected_solution.workflow_delta.before,p.selected_solution.workflow_delta.after);
for (const r of c.binding_json_replacements) out[j] = once(out[j],r.before,r.after);
out[m] += c.binding_md_append;
for (const r of c.cli_identity_replacements) {
  const x = r.constant === 'bindingHash' ? j : m;
  out[s] = once(out[s],`const ${r.constant} = '${r.old}';`,`const ${r.constant} = '${hash(out[x])}';`);
}
for (const x of [w,m,j,s]) {
  assert.equal(out[x],git('show',S+':'+x).toString());
  assert.equal(out[x],fs.readFileSync(x,'utf8'));
}
const mask = t => t.replace(/^(const (?:bindingHash|mdHash) = ')[a-f0-9]{64}(';)/gm,
  '$1'+'0'.repeat(64)+'$2');
assert.equal(mask(old[s]),mask(out[s]));
assert.deepEqual({workflow:hash(out[w]),bindings_json:hash(out[j]),bindings_md:hash(out[m]),
  cli_hash_literals_only:hash(out[s])},c.proposed_byte_hashes);
console.log('PASS_EXACT_ACTUAL_PROJECTION');
NODE
```

Inventory replay: `git -c core.fileMode=false ls-tree -rz --full-tree
221f2f87d94db1656e3000662796d79621b696f5 | shasum -a 256`. Compare each NUL-delimited
record's complete mode/type/blob prefix and path, excluding exactly the four
source changes and four declared old report additions listed in verdict. All
Git invocations in this review use `-c core.fileMode=false`.

## Required next boundary

Fresh registered different-model-family offline supporting acceptance still must
execute the unchanged suite and owned real Git/child-env controls while retaining
full original failures/raw evidence. This review does not borrow Generator
development green lights, pending installs, historical test results or dialogue
claims. Coordinator must separately rule on publication and one new exact-source
non-main INITIAL opportunity; neither source888 rerun nor automatic retry is
authorized here. Changed source, extra byte or different resolved action returns
to the corresponding fresh scope/evidence gate.

Actual Windows checkout, exact runner provenance, real EOF/cleanup, native E0/
PowerShell cause and whole-tree absence remain unverified. Checkout success alone
is not INITIAL completeness, F004/F005 acceptance or release readiness. Compose
HARD_STOP, provider, backup/recovery, deployment/production and release gates
remain unresolved. No native/CI/network/config/keys/state/gate work was performed.

Only these two new docs report files were written using apply_patch. After the
local exact-docs commit and clean/empty own index verification, this critic stops.
