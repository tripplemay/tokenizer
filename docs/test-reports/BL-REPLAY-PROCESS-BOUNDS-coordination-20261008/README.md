# Coordination receipt: bounded replay subprocess follow-up

This is a transport/state record, not a new functional evaluation.

- Exact evaluated candidate: `3130cef3bc55528290c49ee35267e1aff33b5c78`.
- Product source was already frozen at `1c85dba`; F004 added only new tests,
  fixtures, evidence and state. Later commits add coordination docs/state only.
- Scope critic: `spec-lock-final.json`, `violation=false`; 1,277 old tests/reports
  and archived state/input bytes preserved. The critic subsequently checked
  the transported JSON against its return and confirmed field/value equality.
- Scope-result SHA-256: `b1dc021a3d55029dcc56b944a556203ce931a157076d4a43840889765c4702c3`.
  Commit `34351bb` corrected a coordinator hash transcription omission; no
  judgment, original input or product byte changed.
- Functional evaluator: registered Kimi task
  `replay-process-bounds-3130cef-kimi-r0`; process/receipt completed. F001-F005
  returned PASS. Original report, probes, failed probe iterations and logs are
  copied unchanged under `../BL-REPLAY-PROCESS-BOUNDS-kimi-20261008/`.
- `evaluation-session.log` retains the evaluator's raw session output, including
  fresh install, lint and verify outputs not emitted as separate report files.

## Metadata discrepancy and correction

The original verdict in `original-evaluator-verdict.json` used
`BL-REPLAY-PROCESS-BOUNDS-F005` as batch_id. The repository receipt validator
accepted its schema but a stricter coordinator check found it did not equal
the commissioned envelope/features batch. Local state was not closed then.

Separate registered Kimi task `replay-process-bounds-3130cef-kimi-metadata`
checked provenance and produced the canonical verdict with ONLY batch_id
changed to `BL-REPLAY-PROCESS-BOUNDS`. Every other JSON value, timestamp,
feature judgment, evidence and limitation is identical. It did not rerun
tests or provide new functional acceptance. Both envelopes, run metadata,
receipts and raw sessions are retained; its signed addendum is
`../BL-REPLAY-PROCESS-BOUNDS-metadata-correction-20261008.md`.

The original scoped signoff is unchanged. `progress.evaluator_feedback`
contains the complete corrected evaluator artifact, not a coordinator summary.
Five PASS results plus that signoff close ONLY this local batch.

## Boundaries and continuation

Independent standard runs: focused 189 passed/6 skipped; full default and
controlled each 1919 passed/34 skipped. New independent real-process controls:
11 + 7 + 6 = 24. These are the evaluator's recorded results, not new runs here.
Its heavyweight baseline replay reproduction was not rerun; baseline startup
was independently reproduced. Native Windows/Linux exact-SHA CI, PG16,
authenticated browser/original homepage F005, service installation and production
remain unexecuted. Seven Generator-recorded high audit findings are unremediated;
the evaluator used --no-audit. Release readiness remains false.

Next approved work is OpenCode mutable-source/cursor consistency, preserving
the no-implicit-historical-backfill policy, then B08 revision/project CAS and
B04/B05 release/recovery gates. Remaining B03 diagnostic opt-in, replay adapters
and identity/data migrations require their own bounded specifications; raw
diagnostics stay off and no historical cleanup is authorized by this slice.
Do not treat local done as completion of full B03/B07 or the upgrade programme.

No push, deployment or human gate decision occurred. Raw logs retain original
whitespace/terminal output; do not rewrite them to silence diff-check warnings.
