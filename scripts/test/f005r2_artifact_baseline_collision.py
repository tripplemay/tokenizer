#!/usr/bin/env python3
"""F005 reverify-2 · deterministic repro for one non-blocking observation.

`validate-dispatch.sh envelope` pins an evaluator deliverable to the exact path
`docs/test-reports/<batch>-verdict.json`, while
`vm-bridge-provider._reconcile_returned_source` rejects any commissioned
artifact that already exists in the baseline tree
(`VM returned artifact conflicts with the commissioned base`).

For a batch whose verdict file is already committed at the dispatched ref -- e.g.
`docs/test-reports/BL-NATIVE-SUBAGENT-BRIDGES-verdict.json` at
7a84b0dff94649fb617761e4e371bf872dd073aa -- those two rules are jointly
unsatisfiable: the run reaches the vendor, burns the full wall clock, and only
then fails during copy-out reconciliation.

This script proves the interaction without launching a VM and without touching
any product code. Read-only: it writes nothing outside a temporary directory.

Usage:  python3 scripts/test/f005r2_artifact_baseline_collision.py
Exit 0 = the described behaviour reproduced.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROVIDER = REPO / ".claude/dispatch/transports/vm-bridge-provider.py"
LOCKED_REF = "7a84b0dff94649fb617761e4e371bf872dd073aa"
BATCH = "BL-NATIVE-SUBAGENT-BRIDGES"


def load_provider():
    spec = importlib.util.spec_from_file_location("vm_bridge_provider", PROVIDER)
    module = importlib.util.module_from_spec(spec)
    sys.modules["vm_bridge_provider"] = module
    spec.loader.exec_module(module)
    return module


def artifact_tracked_at_locked_ref(relative: str) -> bool:
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{LOCKED_REF}:{relative}"],
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def main() -> int:
    provider = load_provider()
    relative = f"docs/test-reports/{BATCH}-verdict.json"
    findings = {
        "locked_ref": LOCKED_REF,
        "evaluator_commissioned_artifact": relative,
        "artifact_tracked_at_locked_ref": artifact_tracked_at_locked_ref(relative),
    }

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        returned = root / "returned"
        baseline = root / "baseline"
        staging = root / "staging"
        for tree in (returned, baseline, staging):
            (tree / "docs/test-reports").mkdir(parents=True)
        # The child writes the commissioned verdict artifact...
        (returned / relative).write_text('{"probe": true}\n', encoding="utf-8")
        # ...but the dispatched ref already carries a file at that same path.
        (baseline / relative).write_text('{"committed": true}\n', encoding="utf-8")
        (staging / relative).write_text('{"committed": true}\n', encoding="utf-8")

        try:
            provider._reconcile_returned_source(
                returned_root=returned,
                baseline_root=baseline,
                staging=staging,
                role="evaluator",
                artifact=relative,
            )
        except provider.ProviderError as exc:  # expected
            findings["reconcile_outcome"] = "ProviderError"
            findings["reconcile_message"] = str(exc)
        else:
            findings["reconcile_outcome"] = "accepted"
            findings["reconcile_message"] = None

        # Control: the same call succeeds when the artifact path is new.
        fresh = "docs/test-reports/BL-NSB-PROBE-R2-verdict.json"
        (returned / fresh).write_text('{"probe": true}\n', encoding="utf-8")
        (returned / relative).unlink()
        (baseline / relative).unlink()
        (staging / relative).unlink()
        try:
            staged, changed = provider._reconcile_returned_source(
                returned_root=returned,
                baseline_root=baseline,
                staging=staging,
                role="evaluator",
                artifact=fresh,
            )
        except provider.ProviderError as exc:
            findings["control_outcome"] = f"ProviderError: {exc}"
        else:
            findings["control_outcome"] = "accepted"
            findings["control_source_changes"] = list(changed)
            findings["control_staged_artifact_exists"] = staged.is_file()

    print(json.dumps(findings, indent=2, sort_keys=True))
    reproduced = (
        findings["artifact_tracked_at_locked_ref"]
        and findings["reconcile_outcome"] == "ProviderError"
        and findings["control_outcome"] == "accepted"
    )
    return 0 if reproduced else 1


if __name__ == "__main__":
    raise SystemExit(main())
