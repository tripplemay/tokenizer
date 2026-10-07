# B07 queue exact-ACK Generator handoff

This is a Generator handoff for product commit
`8bb0b88fe6ac8e084acb8cd705dec930370354b1`, based on B06 client candidate
`694ff3c7f61664754e88d50f3161fc5d06ac6607`. It is not an independent
Evaluator verdict, release approval, production validation, or human gate
decision. No branch was pushed and no Harness state or gate file was changed.

## Result

The B06 two-process loss is removed for the implemented queue paths. Queue
collection is now a lock-held merge against current disk state. Accepted and
quarantined rows are removed from current disk state by an exact normalized
event-version key under that same queue lock; an in-flight old ACK cannot
truncate a new writer or remove a concurrently collected correction with the
same source identity. Product callers no longer perform stale `remaining`
whole-file checkpoints or an unconditional final clear.

The resolution order is queue lock -> quarantine lock -> quarantine atomic
write -> active queue atomic write. If quarantine fails, the active row is not
removed. If the process dies or the queue write fails after quarantine, the
active row is retried and quarantine's existing identity dedupe prevents an
unbounded duplicate. The queue lock is never acquired while holding the
quarantine lock elsewhere in this implementation.

`rejected-usage.jsonl` and every new/replaced active queue file use an
owner-only temporary file before atomic rename (`0600` on POSIX and current-user
ACL via `icacls` on Windows). Newly created state directories use `0700` on
POSIX. There is deliberately no proactive scan or chmod of user state:

- reading an already canonical legacy queue does not rewrite or chmod it;
- its next normal queue mutation replaces it with an owner-only file;
- a pre-existing `0755` `.tokenizer` directory remains `0755`, while the
  sensitive queue/quarantine files are `0600` after mutation;
- other historical state files are outside this narrow migration.

The immediately preceding B06 server's rowless `400 invalid_json` is handled by
bounded prefix narrowing. Only a singleton whose identical device/envelope
succeeds with an empty event probe is quarantined. If the empty probe also
fails, the Agent keeps the row active and surfaces the original error, so a
device/global/envelope failure cannot be mislabeled as event poison. Rowful
B06 fallback, `usage-partial-v1`, clean legacy 2xx, auth failure, and transient
retry behavior remain covered.

## Deterministic fault and concurrency evidence

`tests/cli/b07-queue-multiwriter.probe.ts` uses actual Node child processes and
localhost TCP HTTP, without a mock filesystem:

1. P1 sends `[good, poison]`; the server barrier starts P2, which adds
   `newly-collected`; P1's partial ACK leaves `newly-collected` active and
   quarantines only `poison`.
2. P1 sends version 1 of `same-id`; P2 appends version 2 while the request is in
   flight; ACKing version 1 leaves version 2 active.
3. P1 is killed after the server receives `crash-retry`; the queue remains; a
   second process receives a duplicate ACK and drains it exactly once.
4. A synthetic preceding-B06 rowless server narrows three rows in seven bounded
   requests, accepts both good rows, proves the poison with an empty probe, and
   drains the queue without pinning the good neighbour.

The raw successful observation is
`evidence/native-two-process.stdout.json`. The wrapper has no POSIX shell or
signal-number dependency and is intended to run unchanged in native Windows
CI; Windows execution is still an external gate, not claimed here.

The immutable B06 prereview probes from commit `41c6821` were copied into an
ephemeral tree over the fixed product and replayed without editing them:

- old loss probe: `finalIds` changed from `[]` to `["newly-collected"]`; exit 1
  is the expected failure of its historical vulnerable assertion;
- old permission probe: file mode changed from `0644` to `0600` and
  `otherTraversableAndReadable` changed to false; exit 1 is the expected failure
  of its historical vulnerable assertion; its intentionally pre-created
  directory remains `0755`;
- old rowless probe made three requests rather than one and failed its old
  assertion. Its fixture unconditionally returns the first poison 400 even for
  later clean/empty requests, so it intentionally remains fail-closed. The new
  real-HTTP successor supplies a server that accepts clean/empty requests and
  proves bounded recovery.

Raw replays are retained as `evidence/frozen-negative-*.txt`. The historical
B06 tests were not edited. Their SHA-256 values remain:

```
fb406333cef1b6c8f035c8750a3a7a914da494c0670e2ee7329ff120216b6eca  tests/cli/b06-batch-failure-queue.test.ts
4b8e4c10f0e173946d341586034da713718573fdaf67e9c69a0c317f04c09b33  tests/cli/b06-partial-ack.test.ts
f73566f46cca6f185d7ad82e4a8519d07ec59c037f03ec8e4629ae0e2d728480  tests/ci/b06-obsolete-queue-test-archive.test.ts
```

Those obsolete callback/whole-file expectations are explicitly archived from
active Vitest discovery. `tests/ci/b07-obsolete-queue-test-archive.test.ts`
checks both their bytes and successor coverage; typechecking still includes
them and passes.

## Verification

Local host: macOS, Node `v22.22.0`.

- `npm run verify`: pass.
- `npm run lint`: pass.
- `npm run build`: pass, production Next build and TypeScript.
- focused portable suite: 16 passed; the one explicit PG probe was correctly
  skipped without its scratch URL.
- full Vitest: 126 files passed, 11 environment-bound files skipped; 1675 tests
  passed, 27 skipped, zero failures.
- isolated native PostgreSQL 16.13 in UTC, 28 migrations: the complete workflow
  selection passed 53 tests with no skips or failures; the new B07 probe itself
  passed 1/1.

The B07 PostgreSQL test invokes the actual route/authentication/Prisma path and
spawns a separate queue writer before the partial ACK is returned. It proves
the good row is committed, poison is absent, poison is quarantined, and the
new concurrent row remains queued. It is not a full deployed Next middleware
or production test. `.github/workflows/deploy-vps.yml` now runs it explicitly
under `EVAL_B07_DB_URL` and raises the no-skip floor from 14 to 15.

Evidence:

- `evidence/environment.txt`
- `evidence/verify-node22.stdout.txt`
- `evidence/build-node22.stdout.txt`
- `evidence/focused-node22.stdout.txt`
- `evidence/full-node22.stdout.txt`
- `evidence/pg16-b07.stdout.txt`
- `evidence/pg16-db-probes.json`
- `evidence/native-two-process.stdout.json`

## Remaining gates and known limits

- Run exact commit `8bb0b88fe6ac8e084acb8cd705dec930370354b1` through the safe branch workflow.
  Native Windows must execute the subprocess, atomic rename, and actual
  `icacls` path; a macOS portable pass is not Windows evidence.
- A different-model-family Evaluator must review the queue identity contract,
  lock ordering, permission migration boundary, workflow result, and artifacts.
- Atomic temp+rename prevents torn process writes but does not call file or
  directory `fsync`; sudden power-loss durability is not claimed.
- Queue and quarantine total size/retention remain unbounded, and quarantine
  still rewrites its bounded-by-current-file contents. This slice does not add
  cleanup policy.
- Parser cursor files are still a separate transaction from the durable queue.
  Queue-before-cursor is preserved, but this commit does not claim a complete
  multi-parser cursor CAS design.
- Server-first B06 deployment remains the preferred rollout. The bounded
  rowless compatibility path is fail-closed for ambiguous global failures; it
  is not a license to run arbitrary new Agents against arbitrary older servers.

Within those boundaries, the commit is ready for **safe-branch CI and
independent evaluation**, not release.
