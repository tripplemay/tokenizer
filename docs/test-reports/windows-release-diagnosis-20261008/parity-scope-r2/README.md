# Independent R2 scope transport review

Supporting harness section 1.5 only. No product/native/release acceptance.

- Exact source: `d1df23737b49acabcb4c5823f75944b378b4e038`.
- Exact tree: `519bcdf7bf8c398ad829f230772616b5753328cf`.
- CLI SHA-256: `dea613a691c9e904fd55427abc2b316a012b9ebc1c80b2b3cefe89642505fa00`.
- Authoritative control output: `controls-frozen-r1.json`.
- Verdict: `violation=true`, `scopeTransportAllowed=false`.

R1 C06/C07/C08/C09 close under independently authored virtual controls.
A further boundary remains: root `child.exitCode`/`child.signalCode` are
published without value validation. C11 shows synthetic raw canaries in
uploaded case JSON; the signal injection can still be marked diagnostic
complete. Actual native canary reachability and real leakage are unknown.

## Replay

Run only while HEAD and the entire tracked worktree equal the exact freeze:

```sh
/Users/yixingzhou/.nvm/versions/node/v22.22.0/bin/node \
  docs/test-reports/windows-release-diagnosis-20261008/parity-scope-r2/controls.mjs \
  d1df23737b49acabcb4c5823f75944b378b4e038 controls-frozen-replay.json
```

Use a new output filename each time. Exit 1 is the expected C11 scope failure.
The CLI source is read from Git; filesystem/process/stream evidence is virtual.
The test does not call PowerShell, product runtime, user services or network.
Syntax/actionlint and Git reads are local real operations.

## Immutable history

`controls-draft-r0.json` is not a gate. Its matching archived control source
retains two initial test defects: C05 required the later counter reason instead
of the earlier logger failure reason; C07 matched the legitimate boolean key
`rawContentFound`. Those defects were corrected in the control code only.

`controls-frozen-r0.json` retains the first frozen C11 assertion failure.
Its matching archived control source and the draft archive both match the
control-source SHA-256 recorded in their original output. Final controls add
root status/signal/pid/error/close metadata cases without altering the CLI.

All original `parity-scope-r1` files and all 32 native originals remain intact.
Only new files in this directory were written by this critic; no commit/push,
state/spec/implementation edits or native acceptance were performed.
