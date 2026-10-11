# Windows P1 C002: exact projection and owned Generator development evidence

Role: supporting Generator under harness-rules.md section 1.5. This is an
implementation/development handoff, not independent Evaluator acceptance,
Windows checkout/native proof, a human gate decision or release readiness.

## Frozen delivery

- Start: `88d07004466251be3076fc454699207d3879374f`.
- Original runtime source221: `221f2f87d94db1656e3000662796d79621b696f5`.
- Exact four-path source commit: `61cf64e67a6fda231bb090e77c19d5ececb908af`.
- Implementation authority: Coordinator adjudication at parent commit `d071207`.
- Narrow npm-owned vendor-link clarification: parent commit `4d938c8`.
- No worker push, source integration, publication, native run or production act.

The source commit uses `--only` for the four paths below and contains no report
addition. Its parent is the start SHA. The later report-only commit contains
only this directory. All Git commands use `-c core.fileMode=false`.

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `.github/workflows/windows-p1-stages-diagnostic.yml` | 3308 | `df3fb58c31bfbd50eed0b833926b9389d0e60673e4df905f05d883dcb7892e2e` |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json` | 34976 | `f022d586a2968ce67b24512631c7d8ab128d1e85cb483e70934e43d8bfe0a130` |
| `docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md` | 25454 | `9ba4ddf4529c0f4ba89fc79a6378e6614c99e62600eee974dd6d57e4a36a6eeb` |
| `docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs` | 73022 | `6548ea1cbf7584873f61b4cb396bc9d4ce8567c672d23313b56a38e8ce0d3bae` |

C002 is the new revision-3/count2/five-string checkout-only map, not compliance
with C001's revision-2/count1/three-key restriction. Only checkout's count and
the second key/value pair changed in YAML. JSON changed only revision, fixed
timestamp, revision scope and checkout_env. Markdown is the original 22275-byte
prefix plus the exact locked section 8. The CLI differs only at the two
64-character identity literals; its masked bytes equal source221. No raw hash
normalization, alternate accepted digest or assertion modification occurred.

`precommit.raw.json`, `postcommit.raw.json` and `postdevelopment.raw.json`
preserve the complete static checks and Git command receipts. Source221's
2457 rows, start's 2463 rows, the six prior report additions and every other
tracked raw blob remain unchanged. Modes/types are unchanged. Ten frozen
inputs also equal source221/predecessor888. All 57 historical archive files
and five parent original CI receipts retain their raw hashes. The original
test remains 53608 bytes / SHA-256
`7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132`.

Consequently all other runtime/tests/assertions, raw hash guards, E0, native
environment allowlist, API/worker/B001, eleven-source/sixteen-upload sets,
selection/caps/bounds/commands/permissions/Secrets/retry, Actions v4, Node22
and historical records are byte/object-preserved. These are Generator static
checks, not independent scope acceptance or native runtime observations.

## Single owned install and original development checks

Node: `22.22.0`; npm: `10.9.4`. Before all imports/tests, HOME and USERPROFILE
were `/Volumes/ORICO/project/.wp1cbg-20261011`; TMP/TMPDIR/TEMP and XDG/npm
caches/config paths were below that owned root. Child environments were built
from the explicit whitelist in `development-after-local-preflight.raw.json`,
not inherited ambient credentials. PATH contains only the installed Node22
directory and `/usr/sbin:/sbin:/usr/bin:/bin`. No real home, system tmp,
queue/configstore, borrowed dependency root or precreated dependency link was
used. This environment arrangement is not a filesystem/network sandbox claim.

| Check | Execution | Result |
| --- | --- | --- |
| Fresh owned dependencies | `npm ci --foreground-scripts`, once | exit 0; important caveats below |
| Syntax | `node --check .../p1-stages.mjs` | exit 0 |
| Pure import | report-owned `pure-import.mjs` | exit 0; validateBindings true, four cases, no forbidden mutation/spawn or installed wrapper |
| Original scoped suite | unchanged `tests/diagnostics/windows-p1-stages.test.ts`, JSON reporter | **81/81**, 0 failed/pending/todo, exit 0 |
| Verify | original `npm run verify` (Prisma generation + tsc) | exit 0 |

`01` through `08` each preserve complete stdout/stderr/status and exact argv,
cwd/environment metadata. `07-original81.raw.json` is the unmodified Vitest
JSON result, 31053 bytes, SHA-256
`453e2da76956c475a0ca19e4e056c16b59c78b15b7f081286239b42cbdcb6bf7`.
The original tests use their own local synthetic fixtures, mocks and VM
helpers. They were not altered or rerun. Their 81 passes are **not** coverage
of the new exact five-key checkout-env confinement contract and do not prove
Windows byte preservation, INITIAL, native PowerShell or product readiness.
No new/old diagnostic CLI prepare/run/probe/seal/verify-upload mode was run.

The dependency root was absent before npmci, and the npm cache was fresh.
`dependency-provenance.raw.json` proves the npm-created braces link resolves
to this same worktree's vendor/braces, its 12 tracked files equal source61 and
source221, and all 47 installed symlink targets stay inside this worktree.
Normal npm `.bin` links are retained; no manual linking occurred. Ignored
machine artifacts are own `node_modules/` and `tsconfig.tsbuildinfo`.

### Install caveats and full failure preservation

1. npm reports **7 high severity vulnerabilities**. No auditfix, dependency
   upgrade, global installation or install retry was attempted. Exit 0 is not
   dependency security acceptance.
2. The original npmci stderr records `@swc/core` native-binding load failure
   and **ERR_SWC_NATIVE_CACHE**: the external cache root has a parent writable
   by another user without trusted sticky protection. No permission change,
   cache relocation, SWC override or reinstall was attempted.
3. The unchanged locked `@swc/core@1.16.13` lifecycle itself launched internal
   `npm install --no-save ... @swc/wasm@1.16.13`. Own npm debug records show
   registry.npmjs.org metadata/tarball GET 200 and the wasm package is present.
   That extra package has no original lock entry: this is **not** a wholly
   lock-only final dependency tree, nor evidence that native SWC now works.
   The agent did not manually install that fallback or replace dependencies.
4. Installed package source references for default Prisma binary host and
   better-sqlite3 public release download are captured in `04-...json`.
   Their actual lifecycle binary requests/redirects were not instrumented.
   All three own npm debug originals are copied byte-for-byte in this report;
   the observable npm requests do not prove complete egress isolation.
5. Initial report driver **STOPPED before any npm execution, target-module
   import or test**, exit 1,
   install_attempts=0, because its preflight wrongly rejected the sole locked
   local resolved=vendor/braces/link=true dependency. Initial script, raw
   capture and `00` stdout/stderr/status remain immutable. Only report
   preflight was corrected; the actual driver/capture use separate names.
6. Actual npmci began `2026-10-11T16:46:05.092Z`, before the narrow vendor
   clarification's `2026-10-11T16:46:16Z` observed time. This sequencing is
   disclosed; no retroactive preflight approval or all-green history is
   invented. Only npm-owned internal links were created, never precreated or
   cross-worktree links. The later clarification was read and byte-checked
   against committed `4d938c8` before post-install provenance capture.

Two report-authoring path mistakes created only new untracked text drafts in
this own worktree root, never running source or parent/main files. Each was
byte-counted/hashed then deleted using absolute apply_patch before further
work; neither was submitted. Tracked diff after recovery was zero:

- `development.tmp`: 85 bytes,
  `2ab096a8df3c5946189e3fedc602b0644d3e5502be4d9c1d3fe27871f04d8217`.
- `capture-dependency-provenance.tmp`: 87 bytes,
  `a0408d9317f96e067f78eef65f6c3706cad3ee7a9a64dcb658e8f1b68d6eddee`.

Both were out-of-report-directory operational mistakes, not hidden by the
final clean tracked diff. All actual manual source/report patches used
absolute paths. The report adds no passing substitute for these initial
failure/operational records.

## Reproduction and retained artifacts

`capture-static.mjs` reconstructs the projection solely from exact source221
blobs and SHA-bound Planner raw strings; it does not run the Planner fixture
or an existing Evaluator. Phases were precommit, postcommit, postdevelopment.
`development.initial.mjs` is the initial STOP driver's preserved source;
`development.mjs` is the separately captured own-worktree local-link fix.
`pure-import.mjs` guards mutations/process launches during read-only import.
`capture-dependency-provenance.mjs` passively inventories own installed links,
vendor source, package fallback references and own npm debug files.

All captures reject overwrite. To reproduce, use a new isolated worktree,
new owned HOME/TMP/cache/report paths and a new source freeze; do not rerun
these captures over retained outputs or reuse this installed dependency tree.
Run from the own worktree under `env -i`, explicit HOME/USERPROFILE/TMPDIR,
the Node22 PATH above, GIT_CONFIG_NOSYSTEM=1 and an absent own global Git file.
Runtime child argv and all explicit environment values are in the status and
development raw files. No CLI/native invocation is needed for these checks.

`generator-report.json` records derived results and unresolved gates.
`artifact-manifest.json` lists every added report artifact's complete path,
byte count and SHA-256 except itself (self-reference excluded). Its own hash
is supplied at handoff; the source/report commits remain separate and local.

## Still pending and not authorized

Fresh independent actual-diff/post-scope and different-family Kimi supporting
gates remain required. Their reports must come from their own fresh review;
these Generator outputs cannot replace them. Windows checkout behavior,
INITIAL/native/functional acceptance, F004/F005 and release readiness remain
open. No Actions/CI/provider/API/SSH/Docker/DB/agent-installer/key/configstore/live
PID/kill or production work was performed. No state/features/pending_gate,
memory/registry/harness write or human gate decision was made.

Compose HARD_STOP/no third Compose persists. User-deferred keys,
backup/restore/baseline/password are untouched. No worker push, main push,
deployment, new-source publication/native opportunity or retry is authorized
by this report. Any further source/key/path/contract change must STOP and
return to fresh Planner/Coordinator authority, not weaken an assertion.
