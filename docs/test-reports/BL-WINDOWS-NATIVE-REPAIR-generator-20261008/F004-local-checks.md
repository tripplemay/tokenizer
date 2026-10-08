# F004 partial execution record; native and release gates remain pending

This is a Generator development-check record, not a scope verdict, functional
acceptance, cross-family acceptance or release signoff. F004 remains pending.

Frozen source commit: `a5a7d59a67e3da61228d05ddd1f297aa12da24e4`.
Only F001/F003 are implemented. F002 is report-only and unresolved; all later
changes are scoped evidence and Generator handoff state, not product/test edits.

Local environment: Darwin/arm64, Node22.22.0, libuv1.51.0; fresh npmci in this
previously node_modules-free worktree, synthetic canonical short HOME/TMPDIR
under `/private/tmp`, telemetry disabled. No real Agent HOME/queue or production
app/DB is used. Dependency/lock/vendor bytes remain frozen. npmci reports7 high
audit vulnerabilities; no dependency-audit closure is claimed or attempted.

| Check | Retained attempts | Observed result |
| --- | --- | --- |
| npm ci | install-1 | exit0;670 packages added |
| lint | lint-1 | exit0 |
| verify | verify-1, verify-2 | exit0 for both |
| build | build-1 | exit0 |
| focused | focused-1, focused-2 | exit0;103 passed/1 skipped each |
| full | full-1, full-2 | exit0;2026 passed/34 skipped each |

Install precedes the implementation, with dependencies unchanged. Verify-1 and
focused-1 ran against final source bytes before all feature commits were made;
lint/build/full-1 ran after the frozen source commit. Verify-2/focused-2/full-2
metadata explicitly records that commit and SHA256 of nine key source/test/
dependency/config files. No original log/report is overwritten. Their raw
stdout/stderr and full JSON test reports retain every failure and skip. The
single focused skip is the existing Windows-only real tree-cleanup case; macOS
results cannot satisfy it. Full suite stdout records170 passed/13 skipped files.

Original red/green development evidence is also retained: privacy controls2
failed/8 passed before F001 then10 passed; newline controls8 failed/3 passed
before normalization then11 passed. The newline baseline already contains the
explicit heading check/helper but lacks normalization, so this reproduces the
CRLF defect, not a byte-identical original historical test run.

`baseline-tracked-inventory.json` records2269 original tracked paths and each
baseline/current blob, mode, SHA256 and byte count. `source-boundary.json` finds
only four allowed original paths changed: privacy.ts, authorized host fixture,
features.json and progress.json. All other original tracked bytes/modes,
including worker/wrapper, old tests/fixtures/timeouts/caps/exclusions, actual
workflow, dependencies/vendor and parent archives, remain identical.
The stronger complete historical expect assertion-call list includes63/63
entries, identical SHA256
`3d7c385089526178ef8d7f91376b424c598ce58b85e9cdcf4e57e31c3ccf56b7`.
This includes expected argument text, extending the earlier F003 immediate
expect-parent expression comparison. It is a byte inventory, not a test verdict.

`original-native-evidence-hashes.json` hashes all30 original diagnostic artifacts
in the sibling worktree without modifying them. Original release unit-failure
log stays unchanged at SHA256
`1d6ccd9641c573f1de858ef723e75f59ba662b5c3f80505e6b80cfa0a22fdb4e`.
`native-gate-status.json` preserves the exact eight original failures and native
skips. No exact candidate native run has been executed by this Generator.
W02/W03/W05/W06/W08 remain unproved; W07/F002 remains pending. F001/F003 native
candidate results also remain pending despite local controls.

Registered fresh cross-family Evaluator must independently derive controls from
actual source and run artifacts. This record cannot close F005, parent native/
production/recovery/Agent/homepage gates, or establish `release_ready=true`.
Status remains building2/5; no worker push/deploy/SSH/Secrets/environment or
human decision operation occurred.
