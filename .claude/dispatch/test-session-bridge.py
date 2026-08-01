#!/usr/bin/env python3
"""Contract tests for the protocol-driven same-session bridge runner."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
TRANSPORTS = HERE / "transports"
sys.path.insert(0, str(TRANSPORTS))
MODULE_PATH = TRANSPORTS / "session-bridge.py"
SPEC = importlib.util.spec_from_file_location("session_bridge_runner", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load session bridge runner")
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


CHILD_RECEIPT_TOKEN = hashlib.sha256(b"future-child-call").hexdigest()


class SessionBridgeRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.worktree = Path(self.temp.name) / "worktree"
        self.worktree.mkdir()
        self.artifact = self.worktree / "docs" / "test-reports" / "bridge-proof.json"
        self.artifact.parent.mkdir(parents=True)
        self.artifact.write_text('{"ok":true}\n', encoding="utf-8")
        self.envelope = {
            "role": "planner",
            "deliverable": {"artifact": "docs/test-reports/bridge-proof.json"},
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_future_acp_cli_joins_by_protocol_declaration_without_tool_branch(self) -> None:
        calls: list[dict[str, object]] = []

        def fake_acp(**kwargs: object) -> dict[str, str]:
            calls.append(kwargs)
            return {
                "bridge_kind": "acp-native-agent/v1",
                "session_id": "future-session",
                "child_call_id": CHILD_RECEIPT_TOKEN,
                "terminal_status": "completed",
            }

        protocol = {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp", "--stdio"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with patch.object(runner, "run_kimi_acp_native_agent", side_effect=fake_acp):
            result = runner.run_bridge(
                bridge_id="future-acp-bridge",
                strategy="session-bridge-v1",
                protocol=protocol,
                persona="planner-proposal",
                envelope=self.envelope,
                worktree=self.worktree,
                timeout_s=60,
            )

        self.assertEqual(calls[0]["command"], ["future-cli", "acp", "--stdio"])
        # Kimi's read-only native plan Agent cannot produce the required
        # planner-proposal artifact. The Harness persona remains planner-only;
        # this is solely the verified Kimi execution class beneath it.
        self.assertEqual(calls[0]["subagent_type"], "coder")
        self.assertIn("subagent_type must be coder", str(calls[0]["prompt"]))
        self.assertEqual(result["bridge_kind"], "acp-native-agent/v1")
        self.assertEqual(result["bridge_id"], "future-acp-bridge")
        self.assertEqual(result["session_scope"], "same-session")
        self.assertEqual(
            result["artifact_sha256"],
            hashlib.sha256(self.artifact.read_bytes()).hexdigest(),
        )

    def test_dormant_app_server_protocol_fails_closed_before_a_cli_can_run(self) -> None:
        protocol = {
            "kind": "app-server-native-agent/v1",
            "command": ["future-cli", "app-server", "--stdio"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with self.assertRaisesRegex(runner.SessionBridgeError, "not published"):
            runner._load_protocol(json.dumps(protocol))

    def test_unknown_protocol_fails_closed_before_a_cli_can_run(self) -> None:
        protocol = {
            "kind": "unreviewed-native-agent/v1",
            "command": ["future-cli", "native"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with self.assertRaisesRegex(runner.SessionBridgeError, "not published"):
            runner._load_protocol(json.dumps(protocol))

    def test_rejects_bridge_proof_that_does_not_match_the_declared_protocol(self) -> None:
        def malformed_acp(**_kwargs: object) -> dict[str, str]:
            return {
                "bridge_kind": "wrong-kind/v1",
                "session_id": "future-session",
                "child_call_id": CHILD_RECEIPT_TOKEN,
                "terminal_status": "completed",
            }

        protocol = {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with patch.object(runner, "run_kimi_acp_native_agent", side_effect=malformed_acp):
            with self.assertRaisesRegex(runner.SessionBridgeError, "proof shape"):
                runner.run_bridge(
                    bridge_id="future-acp-bridge",
                    strategy="session-bridge-v1",
                    protocol=protocol,
                    persona="planner-proposal",
                    envelope=self.envelope,
                    worktree=self.worktree,
                    timeout_s=60,
                )

    def test_rejects_free_text_lineage_before_it_can_reach_a_receipt(self) -> None:
        def hostile_acp(**_kwargs: object) -> dict[str, str]:
            return {
                "bridge_kind": "acp-native-agent/v1",
                "session_id": "peer supplied model output",
                "child_call_id": CHILD_RECEIPT_TOKEN,
                "terminal_status": "completed",
            }

        protocol = {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with patch.object(runner, "run_kimi_acp_native_agent", side_effect=hostile_acp):
            with self.assertRaisesRegex(runner.SessionBridgeError, "identifier"):
                runner.run_bridge(
                    bridge_id="future-acp-bridge",
                    strategy="session-bridge-v1",
                    protocol=protocol,
                    persona="planner-proposal",
                    envelope=self.envelope,
                    worktree=self.worktree,
                    timeout_s=60,
                )

    def test_rejects_a_token_shaped_raw_child_call_id_before_it_can_reach_a_receipt(self) -> None:
        def hostile_acp(**_kwargs: object) -> dict[str, str]:
            return {
                "bridge_kind": "acp-native-agent/v1",
                "session_id": "future-session",
                "child_call_id": "future-child-call",
                "terminal_status": "completed",
            }

        protocol = {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with patch.object(runner, "run_kimi_acp_native_agent", side_effect=hostile_acp):
            with self.assertRaisesRegex(runner.SessionBridgeError, "child-call receipt token"):
                runner.run_bridge(
                    bridge_id="future-acp-bridge",
                    strategy="session-bridge-v1",
                    protocol=protocol,
                    persona="planner-proposal",
                    envelope=self.envelope,
                    worktree=self.worktree,
                    timeout_s=60,
                )

    def test_rejects_a_symlinked_commissioned_artifact(self) -> None:
        target = self.worktree / "safe-content.json"
        target.write_text('{"ok":true}\n', encoding="utf-8")
        self.artifact.unlink()
        self.artifact.symlink_to(target)

        def successful_acp(**_kwargs: object) -> dict[str, str]:
            return {
                "bridge_kind": "acp-native-agent/v1",
                "session_id": "future-session",
                "child_call_id": CHILD_RECEIPT_TOKEN,
                "terminal_status": "completed",
            }

        protocol = {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with patch.object(runner, "run_kimi_acp_native_agent", side_effect=successful_acp):
            with self.assertRaisesRegex(runner.SessionBridgeError, "must not be a symlink"):
                runner.run_bridge(
                    bridge_id="future-acp-bridge",
                    strategy="session-bridge-v1",
                    protocol=protocol,
                    persona="planner-proposal",
                    envelope=self.envelope,
                    worktree=self.worktree,
                    timeout_s=60,
                )

    def test_rejects_a_hardlinked_commissioned_artifact(self) -> None:
        target = Path(self.temp.name) / "outside-content.json"
        target.write_text('{"ok":true}\n', encoding="utf-8")
        self.artifact.unlink()
        os.link(target, self.artifact)

        def successful_acp(**_kwargs: object) -> dict[str, str]:
            return {
                "bridge_kind": "acp-native-agent/v1",
                "session_id": "future-session",
                "child_call_id": CHILD_RECEIPT_TOKEN,
                "terminal_status": "completed",
            }

        protocol = {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        }
        with patch.object(runner, "run_kimi_acp_native_agent", side_effect=successful_acp):
            with self.assertRaisesRegex(runner.SessionBridgeError, "multiple links"):
                runner.run_bridge(
                    bridge_id="future-acp-bridge",
                    strategy="session-bridge-v1",
                    protocol=protocol,
                    persona="planner-proposal",
                    envelope=self.envelope,
                    worktree=self.worktree,
                    timeout_s=60,
                )


if __name__ == "__main__":
    unittest.main()
