# Generator handoff: supporting diagnosis only

No functional acceptance or release signoff is issued by this Generator.
`release_ready` remains false. No push, GH operation, real SSH, real Docker, DB,
credential access or user-queue operation was performed.

## Exact sources and retained history

- Contract: `686d3c6b7e9b7c43ba2d999c56d3435668d06352`.
- Initial source: `65b10cbe3985d933e88eed6c29e7421748af36fd`, in
  `tokenizer-compose-shape-20261009`. `source.diff` preserves that commit.
- Its original post-scope BLOCKED: `007fd07941bad043025003ed0433ca079801e31d`.
- A shared-index race transported the Generator's staged two-test repair in
  Coordinator commit `7df39aa7b6d5039b75d98a1200502a2c89c23922`. It is mixed,
  not docs-only and not the publication candidate; no amend/revert was used.
  See `14-index-race-original.log`.
- Final independently reapplied source:
  `5c5c283b08d225b42d8db19abcbe5d3c1f562ac4`, in
  `tokenizer-compose-shape-repair-20261009`, directly from `007fd079`.
  `repair-source.diff` preserves its two-file F003 repair.

The final repair deletes only the extra old negative-array entry and its new
source-pin exemption. The impossible old ok/zero-byte combination is rejected
by a control in the new shape file, not by changing the old negative array.

## Implementation and explicit old-test scope

The classifier uses a function-local `LC_ALL=C` and shell builtins over the
existing retained shell string. Bash cannot retain NUL; this does not describe
all emitted stdout bytes. Only fixed labels, bounded tail counts and flags are
added. No trim/normalization, added query, fallback or version-acceptance change
was made. Nonzero capture and overflow leave shape null; the original refusal
point, capture argv, order, caps and timeouts remain frozen.

The original 43 host-test file is byte-unchanged. The old 32-observability-test
file was explicitly changed: its baseline-report stripping removes the new
field, its scope/serialization normalization accounts for the classifier, and
its five accepted synthetic fixtures provide consistent shape/null values.
Only the impossible ok fixture's count changes to the version's byte length.
The final old negative array and all other old assertions are unchanged.
There is no claim of zero changes to old diagnostic tests.

The independent new file has 47 controls. It does not import an old test helper.
It covers fixed prefix/tail classes, retained controls, UTF-8 byte counts,
ambient query locale, unchanged argv/refusal/report fields, failure/overflow/
hung capture, canaries, exact validator negatives and mechanical frozen bytes.

## Final development checks on exact 5c5c283

All commands used Node 22.22.0 and the dedicated external-volume HOME/TMP/cache
under `/Volumes/ORICO/project/.csg-20261009`. That path was absent before this
Generator created it. Final repair dependencies are an ordinary independent
`cp -R` copy of the pre-existing host worktree dependencies, not a fresh install.

| Check | Result | Raw artifact |
| --- | --- | --- |
| 43 host + 32 observability + 47 shape controls | 122 passed, exit 0 | `15-repair-exact-source-122-no-cache.log` |
| `npm run verify` | exit 0 | `17-repair-independent-copy-npm-verify.log` |
| `tsc --noEmit --incremental false` | exit 0 | `18-repair-direct-tsc.log` |
| `npm run lint` | exit 0 | `19-repair-npm-lint.log` |
| Targeted test ESLint, max warnings 0 | exit 0 | `20-repair-targeted-test-lint.log` |
| Source boundary and all other old-test blobs | exit 0 | `21-repair-source-boundary.log` |
| `bash -n` / `git diff --check` | exit 0 | `22-repair-shell-syntax.log`, `23-repair-diff-check.log` |

The test command was:
`./node_modules/.bin/vitest run tests/ci/vps-host-preflight.test.ts tests/ci/vps-host-preflight-observability.test.ts tests/ci/vps-compose-version-shape.test.ts --fileParallelism false --no-cache`.
The command environment prefix was:

```sh
env PATH=/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  HOME=/Volumes/ORICO/project/.csg-20261009/h \
  TMPDIR=/Volumes/ORICO/project/.csg-20261009/t \
  npm_config_cache=/Volumes/ORICO/project/.csg-20261009/c \
  XDG_CACHE_HOME=/Volumes/ORICO/project/.csg-20261009/c
```

`npm run verify` generated Prisma Client 5.22.0 only in the repair worktree's own
copied dependencies. The earlier borrowed-dependency phase did not run it.
Fresh `npm ci`, independent functional acceptance, production approval, remote
execution and release readiness remain outside these Generator checks.

## Preserved initial failures and environment-boundary mistake

- `01-host-43.log`: 37 passed/6 failed because the Generator's first PATH omitted
  `/sbin`, where this macOS provides `sha256sum`. `02-...` reran unchanged old
  tests with the corrected environment and passed 43/43.
- `04-shape-controls-initial.log`: 46 passed/1 failed due to the new fixture
  comparing concurrent pipeline-head log interleaving as global query order.
  Only the new fixture was corrected to compare query sequence and head
  argv/count separately; `05-...` passed 47/47.
- `06-direct-tsc.log`: three new-fixture typing errors from missing required
  `NODE_ENV`. Adding `NODE_ENV: test` fixed these; `07-...` passed.
- `11-exact-source-122-controls.log`: 122 passed on original `65b10cb`, but its
  subsequent scope BLOCKED is retained; tests did not override that finding.
- `00-initial-tool-failures.log` retains missing-path inspection failures.

The original dependency symlink was intended to be read-only, but default
Vitest wrote the pre-existing borrowed metadata cache at:
`/Volumes/ORICO/project/.worktrees/tokenizer-host-preflight-observability-20261009/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`.
Observed mtime was `2026-10-09T21:42:45+0700`, matching the original exact-source
test completion. No restoration/deletion was attempted and zero target writes
are not claimed. `12-...` and local CLI source confirmed the cache option;
subsequent tests used `--no-cache` and the authorized independent copy. The old
cache mtime stayed `1791556965` across `13-...` and `16-...`; this narrow check is
not a claim that every old dependency file was audited for prior writes.

All old raw logs and the initial source diff were copied unchanged from the
original branch's Generator directory. Coordinator/Evaluator/critic originals
were not edited or staged by the Generator. Their conclusions belong to their
respective roles, not to this handoff.

After staging raw artifacts, `git diff --cached --check` exited 2 on their
original trailing spaces/blank lines (`25-raw-artifact-staged-diff-check-original.log`).
These logs/diffs are deliberately not normalized. The source-only diff check
in `23-...` passed; an all-artifact whitespace-clean claim is not made.
