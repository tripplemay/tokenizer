# Independent R3 scope transport review

Supporting harness section 1.5 only, not product/native/release acceptance.

- Exact source: `4ea76bcd22360609f0af2fa0da1b99da1b7cd332`.
- Parent R2: `d1df23737b49acabcb4c5823f75944b378b4e038`.
- Exact tree: `b275a9a1f15a72790f77240847ae6dfb460da4f6`.
- CLI SHA-256: `1030e91a2ea4dc2a9e81e876aa391ad19e401fb42c07d91435804d2da6f2603c`.
- Verdict: `violation=false`, `scopeTransportAllowed=true` for this exact source.

All twelve existing independent controls were rerun. C11 now includes root
signal/status/pid/error/close-event canaries, getter exceptions, unsafe launch
values and unsafe finish values. A narrow C13 tests normal metadata, numeric
boundaries, invalid value shapes and unknown/cleanup separation. All thirteen
controls pass twice with byte-identical output from fresh virtual baselines.

The former R2 root export leak and false-completion path close: unsafe values
are suppressed; unknown metadata blocks completion/P2 selection; cleanup and
product result remain explicitly unknown, never inferred failures.

## Replay

Run only while HEAD and the tracked worktree equal the exact freeze:

```sh
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node \
  docs/test-reports/windows-release-diagnosis-20261008/parity-scope-r3/controls.mjs \
  4ea76bcd22360609f0af2fa0da1b99da1b7cd332 controls-frozen-replay.json
```

Choose an unused output filename. Exit 0 is expected. Source comes from Git;
runtime filesystem/process/stream evidence is virtual. Only Git reads, local
syntax/actionlint and new report writes are real. No PowerShell, product
runtime, user service, GitHub, SSH, production or network probes ran.

R1/R2 original conclusions, all initial failures, old control code and all
32 native originals remain untouched and hash-checked. This gate permits only
Coordinator-owned, separately authorized non-main diagnostic transport, not
worker pushes or native/product/release approval.
