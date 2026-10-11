# Windows P1 checkout-only successor proposal

Fresh supporting Planner, `harness-rules.md` section 1.5. Exact source:
`888a5acd7a8a441c9ec4ad898453f149cf8d6b7c` (tree
`19186fe317bce76857dc273a9c21b3e940da9e41`). Created 2026-10-11 UTC.

**Proposal only.** Neither implementation, publication, CI/native execution,
native environment repair, state transition nor release is authorized here.
`release_ready=false`, `release_acceptance=false`, `formal_F005_claim=false`.
No branch is pushed. `main`, production, credentials and backup keys are untouched.
Compose HARD_STOP, F004/F005 and release gates remain unresolved.

## Verified first failure, not a native result

Read directly from the four original run files under:

`/Volumes/ORICO/project/.worktrees/tokenizer-release-readiness-20261008/docs/test-reports/BL-RELEASE-READINESS-coordination-20261011/`

- Run **38145284914**, attempt 1, job **114487223393**, exact source888,
  push to `codex/windows-p1-stages-ci-20261010`: completed/failure.
- First failed step: `actions/checkout@v4`, Git exit **128**. Full original log
  lines 89-90 contain checkout of source888 followed by `Filename too long`.
  The action resolved to `11d5960a326750d5838078e36cf38b85af677262`; Git was
  `2.55.0.windows.5`; workspace was `D:\a\tokenizer\tokenizer`.
- `setup-node`, prepare, `npm ci`, synthetic checks and INITIAL were **skipped**.
  The always-seal step then failed with `MODULE_NOT_FOUND` for `p1-stages.mjs`
  (lines 110/118). This is a secondary incomplete-checkout failure, not an
  independently reached diagnostic defect. Verify/upload were skipped.
- Original artifact API response: **0 artifacts**. Do not fabricate a typed
  summary, native case verdict, sealed evidence, whole-tree absence or a product
  PASS from these logs. No INITIAL admission was observed because its step was
  skipped; workflow orchestration shells are not INITIAL native admissions.

| Original filename suffix after `windows-initial-native-run38145284914-` | Bytes | SHA-256 |
| --- | ---: | --- |
| `final-original.json` | 12339 | `a801a6dbda7f2eed3cc7be6280830540b5cc20e3fae04472e0c0085a5666c3ad` |
| `jobs-original.json` | 2944 | `4320e6204f4ea41da2aec74e436cb229c8d9793f6070306e6c576b1cd9a13d44` |
| `artifacts-original.json` | 32 | `244563f989470892c537c9a4622920af0d228ee4528f7d00c64a06d6cd95856c` |
| `full-original.log` | 18378 | `725070982a434eb7421b339d6fc5886d76f7f7a631a4a381a9c95a79bcbdcd8e` |

The full log has 137 lines. It was not truncated, shortened or copied into this
plan. Original bytes remain at their original paths.

## Path and source evidence

The failed directory is:

```text
docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original/windows-release-diagnostics-719c2df0d54f62b1b3b3e711a2045ffd8ea5e711/windows-release-diagnosis-20261008/native-output-parity-1791483248698
```

`git -c core.fileMode=false ls-tree -rz --full-tree source888` has 2453 tracked
paths; raw NUL-delimited inventory SHA-256 is
`af29538927397b7ec48c261ca047616d9a18617a65f767165b61105d396d1a23`.
At the logged workspace prefix (25 characters including separator), all 55 files
below that directory have Windows absolute lengths **265-281**. The directory
itself is 248 characters; the logged directory-level error does not mean that
directory itself is above 260. The longest tracked relative path is 256
characters, ending in `downstream-off-confirmation.json`, blob
`a3d877dca98202f202013de02e6731f026432da8`.

The failed-subtree inventory SHA-256 is
`6cd55acce1fcd1a225edb9e96c2444c5f3a20f3ae38aaf3a6a2ffa1a78ac902f`.
The enclosing current git archive root has **57** tracked entries, inventory
`52ac3b835b45e6aa3c54ea72f57180421822c5719d2a9e9bca0d2abbbf0a0721`.
These current git-tree counts are **not** the historical 59-file runtime
filesystem inventory. No old 59/57 archive or inventory is rewritten or treated
as freshly authenticated native evidence. All ten referenced frozen/prior source
hashes match the locked JSON; their exact paths and hashes are in `proposal.json`.

## One selected solution: only checkout-step runtime Git configuration

Add exactly four lines to the existing checkout step:

```diff
       - uses: actions/checkout@v4
+        env:
+          GIT_CONFIG_COUNT: '1'
+          GIT_CONFIG_KEY_0: core.longpaths
+          GIT_CONFIG_VALUE_0: 'true'
         with:
           ref: ${{ github.sha }}
           fetch-depth: 1
           persist-credentials: false
```

**Every other workflow byte stays unchanged.** No new shell step, native child,
version query, retry, checkout path, sparse/filter input, permission, Secret,
event/ref, default working directory, timeout, CLI mode or upload change.

Git documents these zero-indexed environment pairs as process-runtime config;
they override config-file values, while explicit `git -c` still takes precedence.
This avoids a persistent config mutation. See the
[Git 2.55 configuration environment contract](https://git-scm.com/docs/git-config/2.55.0#Documentation/git-config.txt-GITCONFIGCOUNT).

`core.longpaths` is Git for Windows builtin-command support, not a general
Windows or native-toolchain repair. See the
[observed Git for Windows version's core configuration](https://github.com/git-for-windows/git/blob/v2.55.0.windows.5/Documentation/config/core.adoc).
GitHub documents step-local environment scope, distinct from workflow/job env:
[workflow step env](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsenv).

The observed checkout action's `execGit` copies `process.env` into its child
environment, then applies its own overrides; the inspected source does not
overwrite the three chosen config keys. See
[the exact resolved checkout implementation](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/src/git-command-manager.ts).
**Inference:** the proposed step keys should reach the checkout Git builtin and
address this observed layer without changing native E0. This is documented
candidate feasibility, **not a performed Windows checkout**. A changed resolved
`v4` action must be independently inspected; no silent upgrade/pinning is included.

The three keys are prohibited at workflow/job scope, in `GITHUB_ENV`, in every
later step, and in owned diagnostic children. The existing CLI reconstructs E0
from exactly five admitted system keys plus its fixed synthetic keys, rather than
spreading the runner environment. `GIT_CONFIG_NOSYSTEM=1`, an owned empty global
config and strict guard key equality stay unchanged. Checkout configuration does
not authorize `APPDATA`, `LOCALAPPDATA`, `SystemDrive`, `PSModulePath`, additional
selectors, a command fallback or any PowerShell environment repair.

### Alternatives compared, not authorized

| Alternative | Why it is broader or weaker here |
| --- | --- |
| Direct `git -c core.longpaths=true` | Narrow scope, but action-owned argv would require wrapping/replacing checkout. |
| `--global` | Adds persistent user config and a shell step; logged action temporarily changes HOME for global operations. |
| `--system` | Machine scope and possible privilege requirement, unnecessary for a per-action setting. |
| `--local` / `--worktree` | Repository does not yet exist; setting after checkout is too late; custom init/config introduces state. |
| Short checkout `path` | Action path is relative **under** already-long `GITHUB_WORKSPACE`; a child path does not shorten it. |
| Custom short root / `subst` | Relocation, working-directory/upload rewrites or host state perturb provenance. |
| Sparse checkout | Omits old archives and changes the full materialized source/evidence contract. |
| OS policy switch / retries | Host-wide repair or repeated execution is not checkout-only scope. |

Path/sparse semantics are documented in the
[exact checkout action README](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/README.md).
Do not delete, move, rewrite or omit historical artifacts to avoid the path error.

## Required explicit contract revision: four files, not hidden permission

The current binding documents only permit three **new** INITIAL files and say
`existing_file_edits_allowed=[]`. Those files now exist. A workflow-only fix would
contradict that contract. This proposal therefore requests a fresh C001 scope
ruling before any edits, not silent reliance on the earlier INITIAL acceptance.

The later Generator allowlist is exactly:

1. `.github/workflows/windows-p1-stages-diagnostic.yml`: the four-line env delta.
2. `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md`: append only the exact
   C001 section held in `proposal.json`; prior text remains intact. The appendix
   explicitly supersedes only the additions-only existing-file prohibition.
3. `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json`: exactly five unique
   byte substitutions specified in `proposal.json`:
   - revision `1 -> 2`;
   - updated timestamp `2026-10-11T05:49:43Z -> 2026-10-11T14:04:39Z`;
   - revision scope `B001-only -> C001 checkout-only exception, B001 unchanged`;
   - empty existing-file allowlist -> these exact four paths;
   - append `workflow.checkout_env` (the three string values) and
     `workflow.checkout_env_scope`, immediately after unchanged checkout inputs.
4. `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs`: **only** the
   `bindingHash` and `mdHash` 64-character literal values, derived from revised
   JSON/Markdown. Masking these two values must make all CLI bytes identical to
   source888. No validator/assertion/guard/import/mode/env/API logic change.

No new implementation file is allowed. No test, fixture, lockfile, old workflow,
frozen runtime, original, state, harness, registry or memory may change. This
Planner's only products are this README and `proposal.json` in its own worktree.

### Exact source hashes before the proposed delta

| Path | SHA-256 |
| --- | --- |
| P1 workflow | `94aa4fa7b31c49dacb71e2643976314351b7a9ad770b51a6e7d982a344bd962b` |
| binding Markdown | `bf60ca426602d00b76515091cc30abd37badea21731b6ad21fe54cd323d7577c` |
| binding JSON | `ed24ebf3b4b1890f84f09ba82edd0d71f75a12e35504a84a3fb0f9d8300455fc` |
| P1 CLI | `3a2d4174c1b2ac3b0caddb4b10c2ba9146c1569247dc6bd6084be01070a4346b` |
| unchanged scoped tests | `7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132` |

The machine-readable before/after strings are normative. Any extra byte, timestamp
variation, other literal, alternate env mechanism or wider scope returns to
Planner/fresh scope; there is no discretion to expand the candidate.

Author-side in-memory rendering of those exact strings yields the following
projected SHA-256 values. **None of these source files was edited or executed.**

| Projected file | SHA-256 after the exact proposed delta |
| --- | --- |
| P1 workflow | `1ab508fc704fe8ceb1aecbdb9b630ea748add97dc5a17a960940ab4e9a83a771` |
| binding JSON / new `bindingHash` literal | `652a11170499b8c03bcd70d65ba4f8cdd1476a318e119b267d33cbf90ed1922d` |
| binding Markdown / new `mdHash` literal | `fc7f4d09915d7200177bf0b4d7c6fc76e95e0423d4e1e2f3f2bc3a1986025ec6` |
| CLI with only two new identity literals | `3028d77985e965d3de58c965b526bfe6adf7ddebced8b9173c89a5fb6c56e4f6` |

### Validator/import closure and existing test limitations

This is why the two CLI identity literal changes are unavoidable when revising
the locked contract; they are not a native repair exception:

- CLI lines 14-21: JSON SHA must equal `bindingHash` **before import completes**.
- CLI lines 76-87: `validateBindings()` checks `mdHash`, ten frozen/prior hashes,
  four scripts/order and the pending-line bound. Only `mdHash` changes.
- CLI lines 663-686: sourceFiles are eleven dynamically hashed paths. Actual
  HEAD/scoped-clean source and `validateProvenance()` still enforce bindingHash,
  source identity, frozen hashes and the unchanged E0 key-name set. No path count,
  schema or verification rule changes.
- CLI lines 313-338: fixed environment construction and strict extra-key guard
  remain byte-identical. Do not admit the checkout keys to native E0.
- Tests lines 495-503 retain no-spawn/no-write import checks. Lines 536-550 lock
  original hashes, scripts, E0, ref, commands, timeout, checkout inputs and upload
  set; they **do not** ban a checkout step env map or hardcode `GIT_CONFIG_*`.
- Tests lines 552-561 require every entry of the **unchanged**
  `required_future_controls`. Adding a declared control without adding matching
  tests would break checks-summary; changing tests/control count is not allowed.

No remaining source-only validator hardcodes revision 1, an empty existing-file
allowlist or the original workflow hash. New checkout metadata is a **static
scope contract**, not a falsely claimed additional runtime validator. Therefore
existing scoped tests are necessary but insufficient: fresh supporting static
positive/negative controls must specifically establish env confinement. The
source test assertions were read, not executed here; any historical 64/81 count
does not become new-candidate acceptance by repetition.

## Future checks and gates, all currently unrun

### Before implementation: fresh scope

Independent fresh supporting critic re-reads both plan files and source888,
hash-checks original inputs and independently renders the exact proposed delta.
It must reject disagreement between bindings/proposal, an additional implementation
path, a stale source, any native-contract change or a hash-check bypass. Coordinator
then explicitly rules on this **four-path** exception. A plan is not a verdict.

### Actual candidate: static and offline supporting acceptance

Let **C** be the actual future immutable full commit SHA, not this docs commit or
the moving diagnostic branch. Compare source888 -> C; list report-only files
separately. Whole-tree mode/path/blob comparison excluding only the four permitted
source paths must preserve every historical archive. The generator handoff must
include exact parent, diff and hashes; workers never push.

Required static negative fixtures, evaluated in memory or an owned disposable
sandbox, include:

- missing/false/count0/count2/extra config pairs; non-string values; any added key
  placed in workflow/job env, later step env, `GITHUB_ENV` or diagnostic child env;
- global/system/local/worktree config writes, new shell command/probe/version
  query/retry, sparse/filter/path/defaults/subst, wider events/ref/permissions,
  Secrets, `continue-on-error` or altered upload boundaries;
- missing/stale identity literal, one-sided bindings revision, one extra CLI byte,
  changed test/frozen hash/native script/E0 key/guard/B001 tuple/budget/selection;
- candidate/HEAD/GITHUB_SHA/source mismatch, dirty source, relabelled old artifact,
  omitted archive, unsafe provenance or upload. All remain fail-closed.

Offline supporting controls use only owned fixtures, no credentials or PowerShell:

- Documented Git config environment precedence in a child with NOSYSTEM plus an
  owned empty global config; verify no persistent config entry or sibling-child
  env contamination. These are disposable tests, **not additional CI probes**.
- Run the unchanged scoped test file on C with Node22/Vitest, retaining its full
  output and actual outcomes. Keep import, B001 tuple/source, cleanup/EOF,
  cap/selection and sealed-artifact negative controls unchanged.
- Feed the checkout keys to existing `systemEnvironment`: only the five admitted
  system keys may survive. Inspect fixedEnvironment/strict guard equality without
  spawning a native process.

Evaluator must be fresh, independent and a **different model family from the
later Generator**. It writes supporting `verdict.json` and full raw outputs in
its own permitted report area. Original verdicts are not rewritten by Planner,
Generator or Coordinator. Additional checkout checks remain separate evidence;
do not pretend the existing scoped suite already covers them.

### Separate Coordinator publication and one execution gate

An accepted C still requires explicit Coordinator authority for non-main
publication and **one new INITIAL workflow opportunity** on the already-locked
`codex/windows-p1-stages-ci-20261010` branch. No worker push; no machine writes
`pending_gate.decision`. This proposal grants neither publication nor execution.
Rerunning source888 cannot execute a changed workflow and is not a repair test.

Capture new final/jobs/artifacts/**full unshortened log** and their hashes; record
resolved actions. Checkout success must be coupled with the existing prepare
proving `actual HEAD = C = GITHUB_SHA`, all eleven current source hashes and clean
scoped source. No added native/version/config inspection command belongs in CI.

The unchanged workflow may then proceed through prepare, npm ci, scoped checks,
one INITIAL, seal/verify and its 16-file upload. All four T0-T3 scripts, E0,
old-trace/common guard, API/worker, B001 source closure, selection, caps, budgets
and quotas remain unchanged (maximum four INITIAL native admissions). Checkout
green alone does not prove even that INITIAL started.

If checkout/provenance fails, or INITIAL is unknown/refused/incomplete, retain
the earliest failure and stop. No automatic retry, extra environment arm,
PowerShell query or native repair. Missing/empty artifact is no sealed observation;
if present, independently verify exactly the new sealed set and manifest. New
native results are separately evaluated against exact C, never relabelled as
source888. F004/F005/release and production/backup gates are not closed by this.

## Author-side boundary and replay

Performed: disk JSON/log reconciliation and hashes; exact-source workflow,
bindings, validator/env-test reads; all ten frozen/prior hash checks; current
git-tree inventories; official primary documentation inspection. Document
consistency checks include unique in-memory substitutions, unchanged locked JSON
subtrees/authority flags, projected source hashes and rechecking original hashes;
they do not constitute independent scope or functional acceptance.

Not performed: implementation, dependency install, synthetic suite, offline Git
behavior test, Windows/native process, CI/rerun, push, production/backup access,
state/gate/registry/memory edits or parent worktree index writes. The exact-source
task used a new worktree; no pull, remote mutation or shared Git configuration
write was necessary or performed. All Git commands used `-c core.fileMode=false`.

Reproduce inventories without modifying files:

```sh
git -c core.fileMode=false ls-tree -rz --full-tree 888a5acd7a8a441c9ec4ad898453f149cf8d6b7c | shasum -a 256
git -c core.fileMode=false ls-tree -rz 888a5acd7a8a441c9ec4ad898453f149cf8d6b7c -- docs/test-reports/windows-native-ci-20261008/runtime-parity-run-37822555762-original | shasum -a 256
```

Adjacent JSON records complete original hashes, exact proposed workflow/binding
deltas, each affected identity check, all future controls and unrun gate fields.
Those future candidate/verdict/publication/execution fields are **null**, not
implicit authority. After one exact-path local docs commit and clean/empty index,
this supporting Planner stops; Coordinator transports the two artifacts.
