# B04+B05 candidate integration check (not a release verdict)

- Base: integration `55a58cb`; B05 generator/evaluator commits were cherry-picked in order into an isolated detached worktree. B04's Windows-native CI fixture remains in the workflow.
- The only production-file difference from B05 candidate `6164b4e` is the B04 installer pair and 18 Windows CI gate lines. B05 deploy/rehearsal/health/standalone code matches that independently reviewed candidate.
- A B05 static test expected an obsolete exact `needs: [verify, verify-windows, release-artifact]` string. B01 had already added `verify-db` and `verify-browser` to the actual deploy dependency list. The initial combined full run failed only that assertion (1693 passed, 1 failed, 23 skipped). The integration-only assertion now requires all five jobs; it does not remove any gate.
- Node 22.22.0 clean `npm ci`, `npm run verify`, `npm run lint`, and corrected full `npm run test`: PASS, 1694 passed / 23 skipped. Plain `npm run build`: PASS. `NEXT_OUTPUT=standalone npm run build` plus `node scripts/verify-standalone.mjs`: PASS, `standalone=clean`.
- This local composition does not prove native Windows, OCI restore, main-only GHCR attestations, actual production predecessor/backup, or release readiness. Run a non-main workflow on this exact combined SHA before considering broader integration.
