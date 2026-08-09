#!/usr/bin/env python3
"""Regression tests for extract-run-usage.py (BL-DISPATCH-USAGE-CAPTURE)."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
TOOL = HERE / "extract-run-usage.py"


def turn(usage: dict) -> str:
    return json.dumps({"type": "turn.completed", "usage": usage})


CODEX_USAGE = {
    "input_tokens": 1000,
    "cached_input_tokens": 600,
    "cache_write_input_tokens": 5,
    "output_tokens": 50,
    "reasoning_output_tokens": 20,
}


def run_tool(log: pathlib.Path, adapter: str, into: pathlib.Path | None = None) -> dict:
    argv = [sys.executable, str(TOOL), "--log", str(log), "--adapter", adapter]
    if into is not None:
        argv.extend(["--into", str(into)])
    completed = subprocess.run(argv, capture_output=True, text=True)
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return json.loads(completed.stdout)


class ExtractRunUsageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="extract-usage-")
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_log(self, *lines: str) -> pathlib.Path:
        log = self.root / "run.log"
        log.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return log

    def test_codex_single_turn_sums_exactly(self) -> None:
        log = self.write_log("[sandbox] noise", turn(CODEX_USAGE))
        bundle = run_tool(log, "codex")
        self.assertEqual(bundle["usage_capture"], "materialize")
        self.assertEqual(
            bundle["usage"],
            {
                "model": None,
                "input_tokens": 1000,
                "cached_input_tokens": 600,
                "cache_write_tokens": 5,
                "output_tokens": 50,
                "reasoning_tokens": 20,
                "turns": 1,
                "extracted_from": "run-log",
            },
        )

    def test_codex_multi_turn_sums_and_counts(self) -> None:
        log = self.write_log(turn(CODEX_USAGE), "not json {", turn(CODEX_USAGE))
        usage = run_tool(log, "codex")["usage"]
        self.assertEqual(usage["turns"], 2)
        self.assertEqual(usage["input_tokens"], 2000)
        self.assertEqual(usage["output_tokens"], 100)

    def test_codex_model_is_picked_up_when_present(self) -> None:
        log = self.write_log(json.dumps({"type": "session.created", "model": "gpt-5-codex"}), turn(CODEX_USAGE))
        self.assertEqual(run_tool(log, "codex")["usage"]["model"], "gpt-5-codex")

    def test_corrupt_usage_yields_null_instead_of_a_guess(self) -> None:
        for bad in [{**CODEX_USAGE, "input_tokens": -1}, {**CODEX_USAGE, "output_tokens": "many"}]:
            log = self.write_log(turn(bad))
            self.assertIsNone(run_tool(log, "codex")["usage"])

    def test_kimi_is_attribution_only_with_null_usage(self) -> None:
        log = self.write_log(json.dumps({"type": "usage.record", "usage": {"input": 5}}))
        bundle = run_tool(log, "kimi")
        self.assertIsNone(bundle["usage"])
        self.assertEqual(bundle["usage_capture"], "attribution_only")

    def test_unknown_adapter_and_missing_log_stay_null_and_exit_zero(self) -> None:
        log = self.write_log(turn(CODEX_USAGE))
        bundle = run_tool(log, "mystery")
        self.assertIsNone(bundle["usage"])
        self.assertIsNone(bundle["usage_capture"])
        missing = run_tool(self.root / "absent.log", "codex")
        self.assertIsNone(missing["usage"])

    def test_into_merges_atomically_and_preserves_other_keys(self) -> None:
        meta = self.root / "run-meta.json"
        meta.write_text(json.dumps({"task_id": "t1", "outcome": "RETURNED"}), encoding="utf-8")
        log = self.write_log(turn(CODEX_USAGE))
        run_tool(log, "codex", into=meta)
        merged = json.loads(meta.read_text(encoding="utf-8"))
        self.assertEqual(merged["task_id"], "t1")
        self.assertEqual(merged["outcome"], "RETURNED")
        self.assertEqual(merged["usage"]["input_tokens"], 1000)
        self.assertEqual(merged["usage_capture"], "materialize")


if __name__ == "__main__":
    unittest.main(verbosity=1)
