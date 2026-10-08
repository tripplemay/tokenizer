# Root return metadata correction R3

Supporting Generator correction only; not an independent verdict, Windows run
or product/release acceptance. Base `d1df23737b49acabcb4c5823f75944b378b4e038`;
source freeze remains `7c6936b97a54f13d1ceb3272f810cf51d28a34f1`.

The original R2 verdict remains unchanged, `violation=true`. Before editing the
CLI, the byte-identical original critic script was copied here and rerun on
R2. `controls-frozen-reproduction.json` preserves the sole C11 failure, exit1.
Its copied independent role label is historical; this copy was executed by the
Generator and is not independent acceptance. Do not overwrite the historical
output by rerunning its archived source against R3.

Only the diagnosed root return boundary changes: `rootMetadata` reads pid,
exitCode and signalCode into a fresh typed snapshot. Unknown values or getter
exceptions export fixed nulls and `rootMetadataUnknown=true`, never the unsafe
original value or exception text. Parent completion/P2 selection fails closed
for unknown metadata, launch errors or non-null signals. Root cleanup metadata
remains independent unknown rather than product cleanup failure. The same
snapshot protects owned-handle cleanup from unsafe PID/metadata reads; no
historical PID is killed. Close event arguments remain unused. Native child
objects, return/exception identity, `errorMonitor`, guard/trace loggers and all
R1 issue corrections are unchanged.

New VM controls cover normal return, unsafe status/signal/pid/error.code, ignored
close status/signal, status/signal/pid/code getter exceptions and a known non-null
signal. All exported virtual artifacts are scanned for injected canaries.
Native reachability of these synthetic unsafe values remains unknown. An initial
local control-script syntax error is retained with its exact draft source and
failure JSON; the fix only removed a mistakenly copied unrelated control opener.
The CLI was not modified to satisfy that tooling failure.

R1/R2 Generator reports, critic originals, 32 native originals, original
diagnostic/trace, all workflows/product/tests/state/spec remain frozen. E0-E4,
old trace off/on with common guard on, no combined arm, 38/76 launch caps,
600s/40s/3s/10s budgets and output caps are unchanged.

Local checks (Node22/macOS, fake VM-only runtime):

```
node docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r3/controls.mjs DRAFT controls-draft-r3.json
node docs/test-reports/windows-release-diagnosis-20261008/parity-generator-r3/checks.mjs
```

Control outputs are append-only; choose a new unused output name for a rerun.
`local-checks.json` is schema-validated. `handoff.json` contains new non-self
artifact hashes, all32 original hashes, both read-only critic inventories and
frozen Git objects. Its own hash is provided separately at commit handoff.
The intentionally invalid archived draft is not a final syntax-check target.
No native Windows/product runtime, push, GH, SSH, service or production operation
was executed. `releaseAcceptance=false`, `releaseReady=false`. A fresh independent
review of the exact new frozen commit remains required before transport.
