# F001 implementation record

Generator implementation record, not an independent acceptance or release verdict.

`src/cli/privacy.ts` now requires a resolved ancestor to be a directory only
when unresolved descendant components remain. Direct, successfully resolved
regular-file event/rule paths retain their prior behavior. The check uses the
canonical resolved path and preserves the event objects and identity fields.
No queue, wire, shared-path, redaction, Git or version implementation changed.

The new `privacy-ancestor.test.ts` contains ten additive controls: the recorded
Windows ENOENT/ENOENT/regular-ancestor sequence is modeled explicitly, alongside
real filesystem event paths, include/exclude rules, ordinary missing directory
tails, direct regular paths, directory alias matching/fingerprinting and closed
EACCES/ELOOP/unresolved-link cases. The local macOS filesystem returns ENOTDIR
for the regular-file child, so its real filesystem rejection alone would not
reproduce the Windows defect.

Original native evidence read in place (unchanged): diagnostic run37808814119,
`privacy.json` and `privacy.trace.jsonl`, trace lines17-19 show regular-child
realpath ENOENT, lstat ENOENT and regular ancestor realpath success. This is a
filter-only defect; no queue or transmitted-data incident is claimed.

Execution logs retained here:
- `privacy-controls-baseline.*`: product code before F001, 2 failed/8 passed.
- `privacy-controls-repaired.*`: product code after F001, 10 passed.
- `verify-1.*`: fresh Node22 type verification exit0 (candidate includes F003).

These are Generator development checks on Darwin/arm64, Node22.22.0,
libuv1.51.0. Exact native Windows and independent cross-family acceptance are
still required and pending. `release_ready=false` is unchanged.
