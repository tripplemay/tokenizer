# Historical evidence input provenance

These files are copied unchanged from Git objects, not new acceptance:

- `upstream-REPORT.md`: `eac098e:docs/test-reports/B03-replay-kimi-evaluator-20261008/REPORT.md`
- `upstream-verdict.json`: same commit and directory, `verdict.json`.
- `upstream-timeout.log`: `00aeca9:docs/test-reports/B03-replay-kimi-evaluator-20261008/evidence/node-syncspawn-timeout-semantics.log`
- `upstream-startup.log`: same commit/directory, `git-stall-startup-evidence.log`.

The report inspected `6a030f6`, not the new combined candidate. Its F1/F2
findings motivate this follow-up. Its F3 records an unsafe early real-home probe;
do not replay that probe. New tests require synthetic homes and explicit paths.

Code candidates through `388163c` are unaccepted reference inputs. Prior safe-
branch CI results cannot accept this takeover branch, and no new CI is triggered
because external agents are prohibited from pushing any branch.
