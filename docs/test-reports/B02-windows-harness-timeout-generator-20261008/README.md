# B02 Windows harness timeout portability - Generator handoff

Date: 2026-10-08

Base: `17b47a8e9128eef1f982afa2f5a3257ec72737d3`

This is a narrow test-only candidate. It is separate from the braces backport
and is not an independent acceptance verdict.

## Observed failure

Safe-branch run
[`37656814992`](https://github.com/tripplemay/tokenizer/actions/runs/37656814992)
ran at the exact base SHA and completed `failure`:

- Verify: success
- Verify (PostgreSQL 16): success
- Verify (authenticated browser): success
- Verify (Windows): failure
- Deploy: skipped

The sole Windows test failure was
`tests/cli/harness.test.ts:577`, `caps structured issues at 20 while retaining
the full failed-project count`. Vitest reported 14,960 ms of native Windows
runtime but failed the unchanged 5,000 ms default timeout. The rest of the job
reported 1,591 passed / 33 skipped. The test deliberately creates 22 secondary
Git repositories plus the primary repository and scans/reports all 23.

The timing issue reproduces locally on Node 22: the unchanged test completed its
synchronous Git work after 6,914.8 ms and was marked failed by the 5-second
timeout. This is not a Windows-only assertion or behavior failure.

## Change

Only that single integration-cost test receives a 30-second per-test timeout:

```ts
it("caps structured issues at 20 while retaining the full failed-project count", async () => {
  // unchanged fixture and assertions
}, 30_000);
```

There is no global `testTimeout` change. The fixture still creates all 22
secondary real Git repositories, and these assertions are byte-for-byte
unchanged:

```ts
expect(result.failed).toBe(23);
expect(result.issues).toHaveLength(20);
expect(result.snapshot.issues).toHaveLength(20);
```

No product source, dependency, workflow, database, queue, credential, release,
state, or human-gate file changes.

Thirty seconds is approximately twice the measured Windows cost and avoids
making normal unit tests globally more permissive. A genuinely hung fixture
still fails at this local ceiling.

## Local validation

Runtime: Node `v22.22.0`, npm `10.9.4`, macOS arm64.

- unchanged focused file: expected reproduction, 1 failed / 26 passed; target
  test 6,914.8 ms and `Test timed out in 5000ms`;
- patched focused file: 27/27 passed; target test 5,157.6 ms;
- full Vitest: 1,602 passed / 23 skipped;
- `npx eslint tests/cli/harness.test.ts`: pass;
- `npm run verify`: pass.

The different skipped counts between local and Windows are existing
platform-gated tests. This candidate does not change them.

## Boundary

This local pass does not establish native Windows or safe-CI readiness. The
coordinator must run the candidate on a non-main safe branch and confirm the
Windows job plus all other required jobs are green. Production/release
acceptance is explicitly not granted here.

## Evidence

- `evidence/windows-ci-run.json`: exact run/SHA/job terminal states.
- `evidence/windows-ci-failed.txt`: live failed Windows job log.
- `evidence/local-before.json` / `.txt`: unchanged local negative control.
- `evidence/local-after.json` / `.txt`: patched focused result.
- `evidence/test-only.diff`: complete source diff.
- `evidence/manifest-scope-check.txt`: no existing report SHA manifest pins this
  test file.
- `evidence/full-vitest.txt`, `eslint-test-file.txt`, `verify.txt`: local gates.
- `evidence/runtime-and-source-hashes.txt`: runtime, base, and test-file hashes.
