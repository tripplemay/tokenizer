#!/usr/bin/env python3
"""Focused protocol tests for the Codex native subagent bridge."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "transports" / "session_bridge_codex.py"
SPEC = importlib.util.spec_from_file_location("session_bridge_codex", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load session_bridge_codex module")
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)

NONCE = "1234567890abcdef1234567890abcdef"
MARKER = f"HARNESS_SUBAGENT_NONCE:{NONCE}"


class RecordingStdin(io.StringIO):
    def close(self) -> None:
        # The driver closes stdin during cleanup; retain captured protocol
        # lines so each test can assert the exact public App Server contract.
        self.closed_by_driver = True


class ScriptedPopen:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.stdin = RecordingStdin()
        self.stdout = io.StringIO("".join(json.dumps(message) + "\n" for message in messages))
        self.stderr = io.StringIO("")
        self.returncode: int | None = None
        self.command: list[str] | None = None
        self.cwd: str | None = None

    def start(self, command: list[str], **kwargs: Any) -> "ScriptedPopen":
        self.command = command
        self.cwd = kwargs["cwd"]
        return self

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    def wait(self, timeout: float | None = None) -> int:
        del timeout
        if self.returncode is None:
            self.returncode = 0
        return self.returncode

    @property
    def sent(self) -> list[dict[str, Any]]:
        return [json.loads(line) for line in self.stdin.getvalue().splitlines()]


def native_child_item(
    *,
    status: str,
    child_status: str,
    prompt: str = f"Child contract. {MARKER}",
    call_id: str = "child-call",
    child_thread_id: str = "child-thread",
) -> dict[str, Any]:
    return {
        "type": "collabAgentToolCall",
        "id": call_id,
        "tool": "spawnAgent",
        "status": status,
        "senderThreadId": "parent-thread",
        "receiverThreadIds": [child_thread_id],
        "agentsStates": {child_thread_id: {"status": child_status}},
        "prompt": prompt,
    }


def native_child_thread(
    *,
    parent_thread_id: str = "parent-thread",
    session_id: str = "session-1",
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": "child-thread",
        "parentThreadId": parent_thread_id,
        "sessionId": session_id,
        "source": source if source is not None else {
            "subAgent": {"thread_spawn": {"parent_thread_id": parent_thread_id, "depth": 1}}
        },
    }


def successful_messages(
    *,
    root_status: str = "completed",
    child_status: str = "completed",
    child_prompt: str = f"Child contract. {MARKER}",
) -> list[dict[str, Any]]:
    return [
        {"id": 1, "result": {"platformOs": "linux"}},
        {"id": 2, "result": {"thread": {
            "id": "parent-thread", "sessionId": "session-1", "ephemeral": False,
        }}},
        {"id": 3, "result": {"turn": {"id": "parent-turn"}}},
        {"method": "item/started", "params": {
            "threadId": "parent-thread", "turnId": "parent-turn",
            "item": native_child_item(status="inProgress", child_status="running", prompt=child_prompt),
        }},
        {"method": "item/completed", "params": {
            "threadId": "parent-thread", "turnId": "parent-turn",
            "item": native_child_item(status="completed", child_status=child_status, prompt=child_prompt),
        }},
        {"method": "turn/completed", "params": {
            "threadId": "parent-thread", "turn": {"id": "parent-turn", "status": root_status},
        }},
        {"id": 4, "result": {"thread": native_child_thread()}},
    ]


class CodexNativeBridgeTests(unittest.TestCase):
    def run_with(self, process: ScriptedPopen) -> dict[str, str]:
        result = bridge.run_codex_native_agent(
            ["fake-codex", "app-server", "--stdio"],
            str(HERE),
            "private root prompt must not appear in the result",
            NONCE,
            1,
            popen=process.start,
        )
        self.assertEqual(process.command[:2], ["fake-codex", "app-server"])
        self.assertEqual(process.command[2], "-c")
        self.assertRegex(
            process.command[3],
            r'^model_instructions_file=".*\.harness-codex-bridge-.*\.md"$',
        )
        self.assertEqual(process.command[4:], ["--stdio"])
        self.assertEqual(process.cwd, str(HERE))
        return result

    def test_proves_exactly_one_native_child_in_the_root_session(self) -> None:
        process = ScriptedPopen(successful_messages())
        result = self.run_with(process)

        self.assertEqual(result, {
            "bridge_kind": "app-server-native-agent/v1",
            "parent_thread_id": "parent-thread",
            "parent_turn_id": "parent-turn",
            "child_call_id": "child-call",
            "child_thread_id": "child-thread",
            "session_id": "session-1",
            "terminal_status": "completed",
        })
        self.assertNotIn("private root prompt", json.dumps(result))
        self.assertTrue(process.stdin.closed_by_driver)
        self.assertEqual(
            [message["method"] for message in process.sent],
            ["initialize", "initialized", "thread/start", "turn/start", "thread/read"],
        )
        self.assertNotIn("jsonrpc", process.sent[0])
        self.assertFalse(process.sent[2]["params"]["ephemeral"])
        self.assertEqual(
            process.sent[3]["params"]["input"],
            [{"type": "text", "text": "private root prompt must not appear in the result"}],
        )
        self.assertEqual(process.sent[4], {"id": 4, "method": "thread/read", "params": {"threadId": "child-thread"}})

    def test_exports_the_generic_runner_error_category(self) -> None:
        self.assertIs(bridge.CodexBridgeError, bridge.CodexSessionBridgeError)

    def test_rejects_native_child_without_the_random_nonce(self) -> None:
        process = ScriptedPopen(successful_messages(child_prompt="unrelated child prompt"))
        with self.assertRaisesRegex(bridge.CodexSessionBridgeError, "bridge nonce"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_a_second_native_child(self) -> None:
        messages = successful_messages()
        messages.insert(5, {"method": "item/started", "params": {
            "threadId": "parent-thread", "turnId": "parent-turn",
            "item": native_child_item(
                status="inProgress", child_status="running", call_id="second-call", child_thread_id="second-thread"
            ),
        }})
        process = ScriptedPopen(messages)
        with self.assertRaisesRegex(bridge.CodexSessionBridgeError, "more than one native child"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_child_that_did_not_complete(self) -> None:
        process = ScriptedPopen(successful_messages(child_status="errored"))
        with self.assertRaisesRegex(bridge.CodexSessionBridgeError, "child did not complete"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_root_that_did_not_complete(self) -> None:
        process = ScriptedPopen(successful_messages(root_status="failed"))
        with self.assertRaisesRegex(bridge.CodexSessionBridgeError, "root turn did not complete"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_child_that_is_not_in_the_parent_session_tree(self) -> None:
        messages = successful_messages()
        messages[-1] = {"id": 4, "result": {"thread": native_child_thread(session_id="other-session")}}
        process = ScriptedPopen(messages)
        with self.assertRaisesRegex(bridge.CodexSessionBridgeError, "parent session tree"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_non_integer_or_unexpected_response_ids(self) -> None:
        cases = (
            (True, "must be an integer"),
            (1.0, "must be an integer"),
            (99, "did not match"),
        )
        for response_id, expected in cases:
            with self.subTest(response_id=response_id):
                messages = successful_messages()
                messages[0]["id"] = response_id
                process = ScriptedPopen(messages)
                with self.assertRaisesRegex(bridge.CodexSessionBridgeError, expected):
                    self.run_with(process)
                self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_peer_notification_flood_before_deadline(self) -> None:
        noise = {"method": "item/started", "params": {}}
        process = ScriptedPopen([noise] * (bridge._MAX_PEER_EVENT_COUNT + 1) + successful_messages())
        with self.assertRaisesRegex(bridge.CodexSessionBridgeError, "peer event budget exceeded"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)


if __name__ == "__main__":
    unittest.main()
