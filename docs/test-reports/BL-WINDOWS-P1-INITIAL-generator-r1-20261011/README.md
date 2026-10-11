# Windows P1 INITIAL: narrow repair development evidence

This is a supporting Generator development report, not a verdict, functional
acceptance, native acceptance, CI result, release signoff or publication authority.

## Exact repair candidate

- Clean starting HEAD: `13f4802ebba124fe84500954087fbb91c09cee11`.
- Source commit: `888a5acd7a8a441c9ec4ad898453f149cf8d6b7c`.
- Source delta: only the approved existing new CLI and diagnostic-local test,
  149 insertions and 14 deletions. Source whitespace check: exit 0.
- Original actual-diff scope report remains BLOCKED and unchanged. This round
  does not rewrite that conclusion or supply a fresh scope verdict.
- Coordinator authority: `initial-post-scope-and-repair-adjudication.json` and
  the separate `initial-repair-addendum-root-symbol.json`.

## Changes, still unaccepted

- PS001: scratch reconstruction and sealed validation now have separate loaders.
  Sealed verification reads the actual bytes, rejects invalid/noncanonical data
  before any reconstruction, and requires each skipped guard/trace to contain
  exactly zero bytes. No sealed data or case record is rewritten or sanitized.
- PS002: the existing two owned-PID signal-0 samples keep a monotonic independent
  sampling-unknown flag. Only ESRCH is recognized as known absence. Permission,
  unsupported, unrecognized or missing error codes force cleanup unknown/root
  retention and incomplete observation; no extra query or wait was added.
- PS003: actual stdout/stderr/combined EOF flags independently force root
  retention, including an already invalid or overflowed parser result. The
  invalid state, parser reason, marker facts and actual EOF flags are preserved.
- Addendum: renamed only `runCase`'s local run-root path parameter and related
  path/environment references, leaving the actual owned `runRoot` call callable.
  The original shadowing failure was recorded before this repair and preserved
  in `pre-repair-blocker.{md,json}` and `01-run-case-shadowing.*`.

No workflow/spec/old runtime/worker/dependency/config/state/harness/memory change,
new source file, CLI/environment selector, real-default dependency injection,
retry, deadline extension, script change, budget/cap/query-count relaxation or
new native launch mode was introduced.

## Complete development attempts

| Attempt | Result |
|---|---|
| 01 unchanged actual runCase in offline VM | expected TypeError reproduced; assertion exit 0; no spawn/query/real setup I/O |
| 02 new controls before source repairs | exit 1; 64 passed, 14 failed, 0 skipped |
| 03 local symbol repair only | exit 1; 66 passed, 12 failed, 0 skipped; PS001-PS003 remain exposed |
| 04 safety repairs | exit 0; 78 passed, 0 failed, 0 skipped |
| 05 initial verify | exit 2; test-only zero-argument mock tuple type error; full failure retained |
| 06 final exact candidate controls | exit 0; 81 passed, 0 failed, 0 skipped |
| 07 final exact candidate verify | exit 0; Prisma generate and TypeScript noEmit; no database operation |
| 08 pure import/identity | exit 0; no spawn/spawnSync/append/mkdir/kill; 14 groups and bound identities matched |
| 09 pure syntax | exit 0 |
| 10 source exact-path commit | exit 0 |
| 11 actual diff/frozen checks | exit 0; two source paths; 47 original development files byte-equal |

The three failed attempts are not erased by later green checks. All stdout and
stderr, complete raw Vitest JSON and separate statuses are retained under unique
paths, including original EOF blank lines. The report whitespace result is
recorded separately in `12-report-whitespace.*`; raw logs must not be trimmed to
make that documentation-only check green.

The final controls include all eight possible skipped guard/trace paths with
seven unsafe/noncanonical/nonempty payloads each and a refreshed manifest, plus
full sixteen-file before/after byte comparisons. The actual current `runCase`
function body is evaluated without transformation in a test-local VM: owned
temporary files and synthetic PID data, mocked root launch/liveness/health/clock
dependencies, six signal-0 mock calls per case and one mock launch. Controls
cover ESRCH absence, five unknown-error categories at each of both samples and
T1/T2 boundaries, and invalid/overflow plus each missing EOF at those boundaries.
This does not execute the real launcher or prove native process behavior.

## Environment and evidence limits

Node `v22.22.0`, libuv `1.51.0`, darwin arm64. Reused this same worktree's prior
own fresh `npm ci` installation; no new installation or fresh-install claim this
round. HOME/USERPROFILE/TMP/TEMP/TMPDIR/npm cache use the owned short external
`/Volumes/ORICO/project/.wp1g-20261011` directories. No borrowed symlink modules.

No old diagnostic, new `--run`/`--probe`/native PowerShell, real PID query,
GitHub/SSH/CI/network/service/Docker/DB/key operation, push, production action,
status/memory update or human-gate decision occurred. Lint was not rerun this
round; the prior lint only covered app/src. No original native inventory or
historical Windows run was reauthenticated.

Both locked specification hashes, ten frozen/prior input hashes, four scripts,
the workflow bytes, old 47-file development report and all state inputs remain
unchanged. `report.json` records exact hashes, every attempt, raw evidence
inventory and untested boundaries. The report-only commit identity and final
clean status are delivered after commit, avoiding self-referential report bytes.

Fresh exact-source actual-diff scope review and applicable different-model-family
functional acceptance remain required, along with independent native/publication/
release gates. Development checks do not close those gates.
