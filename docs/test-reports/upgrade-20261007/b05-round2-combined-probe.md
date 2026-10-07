# B05 round2 combination probe (not release acceptance)

Base: integrated upgrade candidate `ecdd354` (B01/B02/B03/B09/B10 slices).
Cherry-picks: B05 first-round conflict resolution `d6284a4`, B05 round2
`e753a3c` + `2f56300`, B01 SIGTERM/wrapper `8f46980` + `c6915ce`.
`89ffcab` adapts the B05 workflow test to require all B01 gates. No push or
production operation was performed.

Node 22.22.0 local combination checks:

- Clean `npm ci --offline`, `npm run verify`, `npm run lint`, `actionlint`, and
  normal + `NEXT_OUTPUT=standalone npm run build` passed.
- Focused B01/B05 tests: 34 passed, 1 Windows-only skip.
- Complete `npm run test`: 1569 passed, 22 skipped. Opt-in real DB, remote
  contract, native Windows, OCI, and release rehearsal jobs did not run here.

Release blocker found only in the Next 16 combination: `health.ts` uses a
dynamic `readdirSync(migrationsPath)`. Turbopack warns that it traces the whole
project. The standalone output is 91 MB and contains `CLAUDE.md`,
`progress.json`, `features.json`, `src/server/health.ts`, and many
`docs/test-reports/**` files. The B05 runner copies `.next/standalone`, so this
is a real image-content issue, not a harmless warning. B05 round3 must narrow
tracing, prove migration readiness still works, and assert the standalone
artifact does not contain unrelated source, state, or reports.

Neither a local green suite nor a synthetic recovery test substitutes for
native Linux OCI/registry attestation, real CI, legacy VPS digest baseline,
or an authorized production rollback rehearsal.
