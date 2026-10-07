# B02 + B04 + B05 composition probe (not a release verdict)

- Base `8877a59` is the B04+B05 integration probe with Windows raw-evidence checkout protection. Cherry-picked B02 minimal dependency upgrade `17b47a8`, internal `braces` backport `326e68a`, and single Windows Git-fixture timeout `8794f4b` without conflicts. This branch does not alter product behavior beyond those candidates.
- Isolated Node 22 clean `npm ci` completed; full dependency audit still reports **7 High** from the `braces` advisory despite the internal backport. `npm audit --omit=dev --audit-level=moderate` reports 0 production advisories. Do not describe this as an all-graph zero-advisory release.
- Local `npm run verify`, `npm run lint`, and full `npm run test` passed: 130 files / 1704 tests passed, 23 skipped. `NEXT_OUTPUT=standalone npm run build` and `node scripts/verify-standalone.mjs` passed (`standalone=clean`).
- B02 backport plus timeout passed non-main CI run `37660012749` at `b6092cd` (Linux, Windows, PG16, authenticated browser; Deploy skipped). B04+B05 combined CI at `8877a59` and this three-way composition still require their own exact-sha CI before broader integration.
- Neither local tests nor non-main CI constitute main-only GHCR attestation, signed provenance, actual predecessor restore, production canary, or independent cross-family security approval. Production release remains blocked.
