# Windows P1 INITIAL: generator repair development evidence

This supporting Generator report is not a verdict, functional acceptance,
native acceptance, release signoff or publication authority.

## Initial repair boundary

- Exact clean starting HEAD: `13f4802ebba124fe84500954087fbb91c09cee11`.
- Previous source: `0f02b81c72fc399cae6826d4d49418b96ff23e15`.
- Read the complete original actual-diff BLOCKED report and Coordinator's
  `initial-post-scope-and-repair-adjudication.json` before any edit.
- Authority covers PS001-PS003 only, in the existing new CLI/test paths.
- No source edit has been made at this checkpoint.

## Newly identified feasibility blocker

The existing `runCase(c, runRoot, deadline, system)` parameter at CLI line 810
shadows the `runRoot` function declared at line 764. Line 827 calls that parameter
as a function. The actual caller at lines 887 and 894 passes the run-root path
string, not a function. Thus the normal `runCase` path throws before it can reach
its owned-PID samples and cleanup boundary. `runParent` catches this and records
an unknown case; it does not run T0's native control successfully.

Repairing this independent callable-shadowing defect is outside PS001-PS003's
current minimum authority. Source work stopped rather than silently renaming it
or claiming the actual case/cleanup boundary is tested. No native execution or
`--run`/`--probe` occurred. Coordinator was notified for a separate narrow
adjudication. The original reports, all original 64-test logs and source bytes
remain unchanged.

The proposed evidence check is an offline VM evaluation of the unchanged actual
`runCase` function body, with setup/admission/filesystem operations stubbed and a
synthetic path string. It performs no process query, spawn, native invocation,
dependency installation or source modification. Its result will be retained as
an independent raw log rather than replacing any earlier evidence.

## Environment and remaining gates

The prior own fresh `npm ci` dependencies are available for reuse; no new install
or fresh-install claim is made in this repair round. Node 22 and the owned
`/Volumes/ORICO/project/.wp1g-20261011` HOME/TMP/cache remain required. No network,
GitHub/SSH, real service, key, push, state, memory or human-gate action is allowed.

PS001-PS003 remain uncorrected at this initial blocker checkpoint. Any repaired
exact candidate still needs a fresh actual-diff scope review and applicable
different-model-family functional acceptance; none is claimed here.
