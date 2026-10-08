# Runtime parity Generator correction R2

This is supporting Generator work, not an independent scope verdict or a
Windows/product/release acceptance. Base: `5ab1c93894aebcfb2ffad50604e942a10c3655f7`.
Source freeze remains `7c6936b97a54f13d1ceb3272f810cf51d28a34f1`.

## Preserved findings

The original independent R1 verdict is unchanged and still says
`violation=true`. Before changing the CLI, the unchanged critic control script
was copied here and run against R1: C06/C07/C08/C09 reproduced, exit 1, with no
control execution failure. `r1-reproduction.mjs/json` retain that historical
Generator-run reproduction; their copied critic role label does not turn this
execution into independent acceptance. Do not rerun that archived script
against R2 and overwrite its historical result. `controls-initial-10.json`
retains the first R2 intermediate local result, not the final frozen controls.

## Narrow changes

- F001: owned lifetime expiry logs an explicit diagnostic abort; parent lifetime,
  watchdog and output-budget termination are `diagnostic-budget-not-reached`,
  `reached=false`, `productResultUnknown=true`. Cleanup stays an independent
  unknown field, never inferred product failure. Exit 92 also fails closed when
  the logger cannot record the lifetime event.
- F002: exact key/value schemas rebuild guard, old trace, counter and probe
  metadata. Unknown/unsafe/oversized input is suppressed, not copied into
  `native-output-*`. Valid JSONL is freshly serialized. Health sidecars are
  rebuilt too. Native error codes use a fixed structural-code set; unknown codes
  become `UNRECOGNIZED_ERROR_CODE` and guard health fails closed. No raw stderr,
  message, environment value or evidence-file byte fallback is exported.
- C09: complete ordered smoke stages and consistent P2 claims are required;
  downstream protocols require their exact stages, including explicit
  unreachable observations. Setup failures cannot count as complete diagnostics.
- R002: binding include root and cwd are synthetic descendants of the owned case
  root, not fixed potentially real `/allowed/project` or `/different` paths.
- R003: combined counter/logger faults remain failed health and unknown abort
  provenance. A missing abort row does not create diagnostic or product PASS.

Logger failures still cannot replace native returns/exceptions. Error observation
remains `errorMonitor`, without ordinary error listeners in the common guard or
stream data listeners. The parent handles only its own diagnostic-root launch
errors. Historical PIDs receive liveness queries only, never kill signals; owned
active handles retain the original bounded cleanup. Neither close/stdio closure
nor taskkill status proves arbitrary owned-tree cleanup.

## Unchanged boundaries

R2 changes only `native-runtime-parity.mjs` and this new directory. Workflow,
product/tests/state, R1 reports, old diagnostic/trace scripts and all 32 native
originals are frozen. The independent critic directories remain read-only and
untracked; they are not part of this commit.

E0-E4 single-key arms, old trace off/on (common guard on in both), phased
P0/P1/P2 admission, one successful arm per form, 38 smoke/76 total PowerShell
launches, 600s global/40s owned case/3s cleanup reserve/10s product budgets and
existing output caps are unchanged. No combined arm or retry is added. E4 is
the allowlisted SystemRoot-derived built-in Windows PowerShell modules path,
not full machine-environment parity. Remaining budget may leave analogs not
reached; no timeout increase or full-runner environment fallback is permitted.

## Local evidence and handoff

Local commands (Node22 on macOS, fake VM process/filesystem/timers only):

```
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r2/controls.mjs
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r2/checks.mjs
```

The first command writes only new R2 control artifacts; the second checks
syntax, schema, native attribute-script identity, caps, scope, frozen Git
objects and all original hashes, then creates `local-checks.json/handoff.json`.
`handoff.json` includes every non-self R2 artifact, all 32 original hashes, and
read-only hashes of the original critic inputs. Its own digest is supplied at
commit handoff to avoid a circular self-hash. These controls are not native
Windows runs or product runtime evidence. An independent fresh scope verdict on
the frozen commit is required before transport or any authorized CI publication.

The eventual native command remains `node
docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs`.
It is not executed locally. No push, GH, SSH, service, production or credential
operation was performed. `releaseAcceptance=false`, `releaseReady=false`.
