# F003 implementation record

Generator implementation record, not an independent acceptance or release verdict.

Only the authorized historical `tests/ci/vps-host-preflight.test.ts` in-memory
workflow text/extraction changed. CRLF becomes LF without writing workflow or
checkout bytes. The job helper explicitly refuses missing selected/end headings
before slicing. Existing platform skips, timeouts, fixtures, assertions and
release guards/needs remain as before.

New `windows-native-repair-workflow.test.ts` evaluates the actual pure helper
from that fixture (TypeScript transpilation + VM), avoiding duplicate import and
registration of the old test suites. Eleven additive controls cover LF/CRLF
identity for all six guarded release jobs, inventory no-mutation separation,
full release needs and missing selected/end headings for both newline formats.
The code extraction anchors are checked explicitly; the test fails rather than
using a duplicate surrogate if the actual helper cannot be found.

Native original `workflow.json` records821 CRLF and six index-1/guard-absent
checkout results; the LF comparison preserves every guard. Original data was
read in place and unchanged.

Execution logs retained:
- `workflow-controls-baseline.*`: helper before newline normalization, 8 failed/3 passed.
- `workflow-controls-repaired.*`: helper after normalization, 11 passed.
- `focused-1.*`: historical fixture plus privacy/subprocess controls.

AST extraction of all historical expect-call parent expressions at initial
generator HEAD c8e63c5 and candidate:63 versus63; byte-identical serialized list,
SHA256 `0c9d753b2ab150dafa3029c1516b674e6fb709bae746b8c758e9bd65f7dc35e7`.
No assertion or real workflow guard was removed or weakened. Frozen-source
inventory supplies the broader byte/mode boundary checks.

Local checks use Darwin/arm64, Node22.22.0/libuv1.51.0 and are not native Windows
acceptance. F004/F005 and parent release gates remain open, release_ready=false.
