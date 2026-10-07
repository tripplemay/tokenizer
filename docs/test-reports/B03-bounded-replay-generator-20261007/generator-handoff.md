# B03/R07 bounded historical replay - Generator handoff

## Outcome

Implemented the operational R07 slice from integration base
`c721a774c635c2ce06632d0306643fda700c53e3`. The product/test commit is
`d39c79677be619b32476ddeafa603c6f5d761c4a`.

This handoff is ready for an independent Evaluator. It is **not** a claim that
the full B03 backlog is complete or release-ready.

## Delivered behavior

- `tokenizer replay` accepts one literal absolute Claude Code `.jsonl` file,
  canonical UTC `[from,to)`, and explicit byte/event budgets. Dry-run is the
  default; no directory, glob, implicit `HOME`, recursive discovery, or normal
  cursor reset is available.
- The explicit buffer adapter preserves the original path/mtime and ordinary
  Claude parser event IDs without invoking source discovery.
- The reader rejects non-regular files, final-component symlinks/reparse links,
  path/handle identity changes, swaps, growth, byte overflow, records over
  50,000, lines over 1 MiB, and reads/parses exceeding the bounded time.
- Dry-run returns bounded counts and an optional safe sample of at most five
  minimized token summaries. It does not read/write the durable queue, cursor,
  config, or state and does not call Git enrichment or the network.
- Execution requires `--execute --confirm <planDigest>`. The digest binds file
  identity/content, source, path, time window, budgets, max-files contract,
  collection scope fingerprint, and privacy mode. The file and config are
  re-read immediately before admission. Paused mode rejects execution.
- Matching events are filtered through current include/exclude admission,
  minimized, and idempotently merged into the durable queue. Normal parser
  cursors are untouched and no immediate upload occurs. Existing backlog is
  retained; sync-mode backlog uploads on the next Agent/`run`/`sync` cycle.
- Collection and replay use one locked atomic queue merge. Sync ACK now removes
  only the exact serialized versions actually sent, preserving concurrent new
  events and corrected same-ID events instead of rewriting a stale tail.

## Verification

Environment: macOS arm64, Node `v22.22.0`.

| Check | Result |
| --- | --- |
| `npm run verify` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS: 124 files, 1,613 tests; 9 files / 23 tests skipped by existing environment gates |
| `npm run build` | PASS |
| Focused replay/admission/sync/evaluator set | PASS: 9 files, 88 tests |
| `git diff --check` | PASS |

Focused negatives cover broad/unknown scope, noncanonical or excessive bounds,
strict interval edges, event/byte/record/line overflow, directory and symlink,
deterministic path swap and growth, unselected sibling files, stale digest after
file/scope/mode changes, paused mode, queue corruption, idempotence, cursor byte
preservation, old backlog retention, no configure-time upload, next-cycle sync,
six-process queue writer concurrency, and exact-version ACK preservation.

## Independent evaluation priorities

1. Re-run the Node 22 focused and full suites from the exact product commit.
2. Inspect the real CLI subprocess flow: dry-run queue/cursor bytes unchanged,
   digest-confirmed execution, second execution duplicate, then next-cycle sync.
3. Exercise Windows-native symlink/junction/reparse behavior. This Generator run
   was macOS-native only; Windows behavior is code-reviewed and mocked/portable,
   not natively proven here.
4. Adversarially race a real `collect`, replay execution, and sync ACK against
   the same queue. The shared atomic primitives and multiprocess tests pass, but
   independent process-level scheduling remains valuable.
5. Confirm the sample/error surface is acceptably minimal for local privacy.

## Explicit exclusions / remaining B03 work

- No replay adapter exists for Codex, OpenCode, Aider, or Kimi Code.
- Raw diagnostic opt-in/expiry, versioned path-containing identity migration,
  production historical cleanup, live multi-tenant canary, fleet rollout, and
  release/publish/deploy evidence remain outside this slice.
- No historical user data, normal cursor, `progress.json`, status, pending gate,
  remote branch, release tag, or production system was changed.
- The earlier B03 evaluator reports remain unchanged. One executable historical
  evaluator test was advanced from the old "execution unsupported" contract to
  the new separately confirmed execution-plan contract so the current suite
  tests the implemented R07 phase rather than a superseded expectation.
