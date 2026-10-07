# B07 versioned quarantine and archived-test checkout repair

Generator handoff only; not an independent Evaluator verdict, native Windows CI result, release approval, or production validation. No push or Harness state/gate change.

## Inputs and changes

Base product tree: `4979042e3cf8d2c5f06ed5de13372e49d0bab855`. The independent same-family prereview artifact `948663362c518a7145e67a56d99ceb9c2f04ae96` was cherry-picked without changing its tests, verdict, report, or raw logs. Its original finding remains a BLOCK for the base candidate; this report describes the successor fix.

- `src/cli/queue-event-version.ts` centralizes the existing sanitize/minimize/JSON version transform. Active queue and rejected quarantine now use the same exact normalized version key; `src/cli/queue.ts` retains its public `queueEventVersion` export. Different versions of one source ID coexist, while an identical retry still deduplicates.
- `src/cli/rejected-events.ts` now maps existing and newly rejected rows by that version, not `source + sourceEventId`. A successful quarantine write therefore cannot silently skip a corrected payload that the subsequent active-queue write removes.
- `.gitattributes` sets `-text` for exactly the three B06 tests whose immutable raw SHA-256 values the B07 archive test checks. Their Git blob bytes and expected hashes are unchanged. `tests/ci/b07-obsolete-queue-eol-policy.test.ts` checks Git's effective attributes.
- `tests/cli/b07-versioned-quarantine.test.ts` covers sequential same-ID correction, both versions rejected together, identical retry dedupe, and an injected queue-write failure between quarantine and active-queue persistence.

## Reproduction and checks

On the base candidate, the new three-case Generator regression was 0/3: the later `inputTokens=200` version disappeared from both durable files while the old `inputTokens=1` quarantine row remained. On the successor, the identical test is 3/3 PASS.

The frozen prereview tests flipped from their original **4 passed / 5 failed unit, 1 passed / 1 failed native-process** to **9/9 unit and 2/2 native-process PASS**. The unit cases include real `syncEvents` partial ACK, old-server rowless fallback, same-response versions, and injected queue-write fault. The process cases use fresh separate Node processes and an eight-writer control. The prereview's files and recorded base-candidate observations were not rewritten; for example, the prereview `verdict.json` Git blob remains `04224af938e170031421d4e3b6c94d71a96cc10d`.

Fresh Node `v22.22.0` `npm ci --no-audit --no-fund` in this isolated worktree:

| Command | Result |
| --- | --- |
| `npx vitest run tests/cli/b07-prereview-version-negative.test.ts tests/cli/b07-prereview-process.test.ts` | 11/11 PASS |
| `npx vitest run tests/cli/b07-versioned-quarantine.test.ts tests/ci/b07-obsolete-queue-eol-policy.test.ts tests/ci/b07-obsolete-queue-test-archive.test.ts` | 6/6 PASS |
| `npm run verify` | PASS |
| `npm run lint` | PASS |
| `npm test` | 1690 passed / 27 skipped, no failures |
| `npm run build` | PASS, Next production build and TypeScript |

Checkout conversion control: `git -c core.autocrlf=true worktree add --detach <temporary-path> HEAD` produced CRLF in an unpinned new `.test.ts`, proving the simulated checkout conversion was active. The pinned `b06-batch-failure-queue.test.ts` retained LF bytes and SHA-256 `fb406333cef1b6c8f035c8750a3a7a914da494c0670e2ee7329ff120216b6eca`; the other two pinned tests retained `4b8e4c10f0e173946d341586034da713718573fdaf67e9c69a0c317f04c09b33` and `f73566f46cca6f185d7ad82e4a8519d07ec59c037f03ec8e4629ae0e2d728480`. The temporary worktree was removed under the same `core.autocrlf=true` setting. `git check-attr text -- <three paths>` reports `text: unset` for each.

## Remaining gates

An exact-SHA **native Windows CI rerun** is still required; the macOS `core.autocrlf=true` checkout simulation is not Windows execution. A different-model-family Evaluator must assess this successor from its exact commit rather than treat this Generator report or the preserved base-candidate prereview as signoff. No power-loss `fsync` guarantee or quarantine retention bound is added by this narrow correction.
