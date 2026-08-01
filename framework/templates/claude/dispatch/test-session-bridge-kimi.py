#!/usr/bin/env python3
"""Focused ACP lifecycle tests for the same-session native Agent bridge."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "transports" / "session_bridge_kimi.py"
SPEC = importlib.util.spec_from_file_location("session_bridge_kimi", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load session_bridge_kimi module")
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


class RecordingStdin(io.StringIO):
    def close(self) -> None:
        self.closed_by_driver = True


class InterruptingStdin(RecordingStdin):
    def __init__(self, interrupt: Any) -> None:
        super().__init__()
        self._interrupt = interrupt
        self._interrupted = False

    def write(self, value: str) -> int:
        written = super().write(value)
        if not self._interrupted:
            self._interrupted = True
            self._interrupt()
        return written


class ScriptedPopen:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.stdin = RecordingStdin()
        self.stdout = io.StringIO("".join(json.dumps(message) + "\n" for message in messages))
        self.stderr = io.StringIO("")
        self.returncode: int | None = None
        self.command: list[str] | None = None
        self.cwd: str | None = None
        self.kwargs: dict[str, Any] | None = None
        self.terminate_called = False
        self.on_start: Any = None

    def start(self, command: list[str], **kwargs: Any) -> "ScriptedPopen":
        self.command = command
        self.cwd = kwargs["cwd"]
        self.kwargs = kwargs
        if self.on_start is not None:
            self.on_start()
        return self

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminate_called = True
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


def successful_messages(
    *,
    description: str = "harness-child:0123456789abcdef",
    subagent_type: str = "plan",
    stop_reason: str = "end_turn",
) -> list[dict[str, Any]]:
    return [
        {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": 1}},
        {"jsonrpc": "2.0", "id": 2, "result": {"sessionId": "session-1"}},
        {"jsonrpc": "2.0", "id": 3, "result": {}},
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "child-call-1",
                    "status": "pending",
                    "title": "Agent",
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "child-call-1",
                    "status": "in_progress",
                    "title": "Launching plan agent",
                    "rawInput": {
                        "description": description,
                        "subagent_type": subagent_type,
                    },
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "child-call-1",
                    "status": "completed",
                },
            },
        },
        {"jsonrpc": "2.0", "id": 4, "result": {"stopReason": stop_reason}},
    ]


class KimiAcpBridgeTests(unittest.TestCase):
    nonce = "0123456789abcdef"

    def setUp(self) -> None:
        # Focused protocol tests must never copy a developer's real Kimi state.
        self.environment = patch.dict(bridge.os.environ, {"KIMI_CODE_HOME": ""}, clear=False)
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    def run_with(self, process: ScriptedPopen) -> dict[str, Any]:
        result = bridge.run_kimi_acp_native_agent(
            ["fake-cli", "acp"],
            str(HERE),
            "private root prompt must not appear in bridge proof",
            self.nonce,
            "plan",
            1,
            popen=process.start,
        )
        self.assertEqual(process.command, ["fake-cli", "acp"])
        self.assertEqual(process.cwd, str(HERE))
        return result

    def test_proves_agent_call_and_terminal_update_without_peer_text(self) -> None:
        process = ScriptedPopen(successful_messages())
        result = self.run_with(process)

        self.assertEqual(result, {
            "bridge_kind": "acp-native-agent/v1",
            "session_id": "session-1",
            "child_call_id": hashlib.sha256(b"child-call-1").hexdigest(),
            "terminal_status": "completed",
        })
        self.assertNotIn("private root prompt", json.dumps(result))
        self.assertNotIn("child-call-1", json.dumps(result))
        self.assertTrue(process.stdin.closed_by_driver)
        self.assertEqual(
            [message["method"] for message in process.sent],
            ["initialize", "session/new", "session/set_config_option", "session/prompt"],
        )
        self.assertEqual(process.sent[2]["params"], {
            "sessionId": "session-1", "configId": "mode", "value": "auto",
        })
        if bridge.os.name == "posix":
            self.assertIs(process.kwargs["start_new_session"], True)

    @unittest.skipUnless(bridge.os.name == "posix", "requires POSIX process groups")
    def test_terminates_the_dedicated_process_group(self) -> None:
        process = ScriptedPopen(successful_messages())
        process.pid = 4242
        calls: list[tuple[int, int]] = []

        def killpg(pgid: int, sig: int) -> None:
            calls.append((pgid, sig))
            if sig == 0:
                raise ProcessLookupError
            process.returncode = 0

        with patch.object(bridge.os, "getpgid", return_value=process.pid), patch.object(
            bridge.os, "killpg", side_effect=killpg,
        ):
            self.run_with(process)

        self.assertTrue(process.stdin.closed_by_driver)
        self.assertFalse(process.terminate_called)
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(calls[0], (process.pid, bridge.signal.SIGTERM))
        self.assertIn((process.pid, 0), calls)

    @unittest.skipUnless(bridge.os.name == "posix", "requires POSIX process groups")
    def test_host_contained_bridge_leaves_reaping_to_the_outer_timeout_group(self) -> None:
        process = ScriptedPopen(successful_messages())
        process.pid = 4242
        group_calls: list[tuple[int, int]] = []

        with patch.dict(
            bridge.os.environ,
            {"HARNESS_BRIDGE_OUTER_GROUP_CLEANUP": "1"},
            clear=False,
        ), patch.object(bridge.os, "killpg", side_effect=lambda pgid, sig: group_calls.append((pgid, sig))):
            self.run_with(process)

        self.assertNotIn("start_new_session", process.kwargs)
        self.assertEqual(group_calls, [])
        self.assertFalse(process.terminate_called)

    @unittest.skipUnless(bridge.os.name == "posix", "requires POSIX process groups")
    def test_interrupt_reaps_only_the_dedicated_group_before_outer_timeout_can_kill_bridge(self) -> None:
        for cancellation_signal in (bridge.signal.SIGTERM, bridge.signal.SIGINT):
            with self.subTest(signal=cancellation_signal):
                process = ScriptedPopen(successful_messages())
                process.pid = 4242
                group_calls: list[tuple[int, int]] = []
                signal_calls: list[tuple[int, Any]] = []
                handlers: dict[int, Any] = {}
                previous = {
                    bridge.signal.SIGTERM: object(),
                    bridge.signal.SIGINT: object(),
                }

                def killpg(pgid: int, sig: int) -> None:
                    group_calls.append((pgid, sig))
                    if sig == 0:
                        raise ProcessLookupError
                    if sig == bridge.signal.SIGKILL:
                        process.returncode = -9

                def set_signal(sig: int, handler: Any) -> Any:
                    signal_calls.append((sig, handler))
                    if callable(handler):
                        handlers[sig] = handler
                    return previous[sig]

                def interrupt() -> None:
                    handlers[cancellation_signal](cancellation_signal, None)

                process.stdin = InterruptingStdin(interrupt)
                with patch.object(bridge.os, "getpgid", return_value=process.pid), patch.object(
                    bridge.os, "killpg", side_effect=killpg,
                ), patch.object(bridge.signal, "signal", side_effect=set_signal):
                    with self.assertRaisesRegex(bridge.KimiBridgeError, "interrupted"):
                        self.run_with(process)

                self.assertEqual(group_calls[0], (process.pid, bridge.signal.SIGKILL))
                self.assertTrue(all(pgid == process.pid for pgid, _sig in group_calls))
                self.assertFalse(process.terminate_called)
                self.assertTrue(process.stdin.closed_by_driver)
                # Handler installation and restoration are both part of the
                # lifetime boundary; do not leave cleanup installed.
                self.assertEqual(signal_calls[-2:], [
                    (bridge.signal.SIGTERM, previous[bridge.signal.SIGTERM]),
                    (bridge.signal.SIGINT, previous[bridge.signal.SIGINT]),
                ])

    @unittest.skipUnless(bridge.os.name == "posix", "requires POSIX process groups")
    def test_interrupt_between_spawn_and_group_binding_reaps_the_pending_group(self) -> None:
        """Cover the window where Popen has made B but Python has not bound it."""
        process = ScriptedPopen(successful_messages())
        process.pid = 4242
        group_calls: list[tuple[int, int]] = []
        signal_calls: list[tuple[int, Any]] = []
        handlers: dict[int, Any] = {}
        previous = {
            bridge.signal.SIGTERM: object(),
            bridge.signal.SIGINT: object(),
        }

        def killpg(pgid: int, sig: int) -> None:
            group_calls.append((pgid, sig))
            if sig == 0:
                raise ProcessLookupError
            if sig == bridge.signal.SIGKILL:
                process.returncode = -9

        def set_signal(sig: int, handler: Any) -> Any:
            signal_calls.append((sig, handler))
            if callable(handler):
                handlers[sig] = handler
            return previous[sig]

        def interrupt_after_spawn() -> None:
            # The bridge handler is already installed, but no process group is
            # bound yet. It must record and then kill B after Popen returns.
            handlers[bridge.signal.SIGTERM](bridge.signal.SIGTERM, None)

        process.on_start = interrupt_after_spawn
        with patch.object(bridge.os, "getpgid", return_value=process.pid), patch.object(
            bridge.os, "killpg", side_effect=killpg,
        ), patch.object(bridge.signal, "signal", side_effect=set_signal):
            with self.assertRaisesRegex(bridge.KimiBridgeError, "interrupted"):
                self.run_with(process)

        self.assertEqual(group_calls[0], (process.pid, bridge.signal.SIGKILL))
        self.assertTrue(all(pgid == process.pid for pgid, _sig in group_calls))
        self.assertTrue(process.stdin.closed_by_driver)
        self.assertEqual(process.sent, [])
        self.assertEqual(signal_calls[-2:], [
            (bridge.signal.SIGTERM, previous[bridge.signal.SIGTERM]),
            (bridge.signal.SIGINT, previous[bridge.signal.SIGINT]),
        ])

    @unittest.skipUnless(bridge.os.name == "posix", "requires POSIX process groups")
    def test_rejects_an_unverifiable_real_posix_process_group(self) -> None:
        process = ScriptedPopen(successful_messages())
        process.pid = 4242
        with patch.object(bridge.os, "getpgid", return_value=1):
            with self.assertRaisesRegex(bridge.KimiBridgeError, "not verifiable"):
                self.run_with(process)
        self.assertTrue(process.terminate_called)

    @unittest.skipUnless(bridge.os.name == "posix", "requires POSIX process groups")
    def test_interrupt_during_handler_install_never_starts_the_cli(self) -> None:
        process = ScriptedPopen(successful_messages())
        previous = {
            bridge.signal.SIGTERM: object(),
            bridge.signal.SIGINT: object(),
        }
        signal_calls: list[tuple[int, Any]] = []

        def set_signal(sig: int, handler: Any) -> Any:
            signal_calls.append((sig, handler))
            if sig == bridge.signal.SIGINT and callable(handler):
                handler(sig, None)
            return previous[sig]

        with patch.object(bridge.signal, "signal", side_effect=set_signal):
            with self.assertRaisesRegex(bridge.KimiBridgeError, "interrupted"):
                self.run_with(process)

        self.assertIsNone(process.command)
        self.assertEqual(signal_calls[-2:], [
            (bridge.signal.SIGTERM, previous[bridge.signal.SIGTERM]),
            (bridge.signal.SIGINT, previous[bridge.signal.SIGINT]),
        ])

    def test_hashes_vendor_child_call_text_before_returning_a_receipt(self) -> None:
        raw_call_id = "model output leaked"
        messages = successful_messages()
        for index in (3, 4, 5):
            messages[index]["params"]["update"]["toolCallId"] = raw_call_id
        process = ScriptedPopen(messages)
        result = self.run_with(process)
        self.assertEqual(result["child_call_id"], hashlib.sha256(raw_call_id.encode("utf-8")).hexdigest())
        self.assertNotIn(raw_call_id, json.dumps(result))

    def test_runs_acp_with_a_private_kimi_home_and_removes_it_afterward(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source-kimi"
            (source / "credentials").mkdir(parents=True)
            (source / "credentials" / "token.json").write_text('{"token":"fixture"}', encoding="utf-8")
            (source / "oauth").mkdir()
            (source / "oauth" / "device.json").write_text('{"device":"fixture"}', encoding="utf-8")
            (source / "config.toml").write_text("model = 'fixture'\n", encoding="utf-8")
            (source / "sessions").mkdir()
            (source / "sessions" / "raw-acp-id.log").write_text("must not copy", encoding="utf-8")
            (source / "plugins").mkdir()
            process = ScriptedPopen(successful_messages())
            observed: dict[str, Path] = {}

            def observe_private_home() -> None:
                environment = process.kwargs["env"]
                private_home = Path(environment["KIMI_CODE_HOME"])
                observed["private_home"] = private_home
                self.assertNotEqual(private_home, source)
                self.assertTrue((private_home / "credentials" / "token.json").is_file())
                self.assertTrue((private_home / "oauth" / "device.json").is_file())
                self.assertTrue((private_home / "config.toml").is_file())
                self.assertFalse((private_home / "sessions").exists())
                self.assertFalse((private_home / "plugins").exists())
                # Simulate a vendor session record. It must disappear with the
                # bridge state and never become part of the returned proof.
                (private_home / "raw-child-call-id.log").write_text("raw vendor id", encoding="utf-8")

            process.on_start = observe_private_home
            with patch.dict(bridge.os.environ, {"KIMI_CODE_HOME": str(source)}, clear=False):
                result = self.run_with(process)

            self.assertFalse(observed["private_home"].exists())
            self.assertNotIn("raw vendor id", json.dumps(result))

    def test_rejects_symlinked_kimi_credential_state_before_starting_the_cli(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source-kimi"
            source.mkdir()
            target = Path(raw) / "outside"
            target.mkdir()
            (source / "credentials").symlink_to(target, target_is_directory=True)
            process = ScriptedPopen(successful_messages())
            with patch.dict(bridge.os.environ, {"KIMI_CODE_HOME": str(source)}, clear=False):
                with self.assertRaisesRegex(bridge.KimiBridgeError, "symlinks"):
                    self.run_with(process)
            self.assertIsNone(process.command)

    def test_rejects_non_token_session_and_unsafe_raw_child_identifiers(self) -> None:
        cases = {
            "session": ("session id", "model output leaked"),
            "control": ("tool-call identifier", "unsafe" + chr(1) + "id"),
            "surrogate": ("tool-call identifier", "unsafe" + chr(0xD800) + "id"),
            "oversize": ("tool-call identifier", "x" * 513),
        }
        for label, (expected, invalid) in cases.items():
            with self.subTest(label=label):
                messages = successful_messages()
                if label == "session":
                    messages[1]["result"]["sessionId"] = invalid
                else:
                    messages[3]["params"]["update"]["toolCallId"] = invalid
                process = ScriptedPopen(messages)
                with self.assertRaisesRegex(bridge.KimiBridgeError, expected):
                    self.run_with(process)
                self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_a_nonmatching_agent_nonce(self) -> None:
        process = ScriptedPopen(successful_messages(description="harness-child:other-nonce"))
        with self.assertRaisesRegex(bridge.KimiBridgeError, "matching native Agent"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_more_than_one_native_agent_call(self) -> None:
        messages = successful_messages()
        messages.insert(5, {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "second-child-call",
                    "status": "pending",
                    "title": "Agent",
                },
            },
        })
        process = ScriptedPopen(messages)
        with self.assertRaisesRegex(bridge.KimiBridgeError, "exactly one native Agent"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_a_nonterminal_root_prompt(self) -> None:
        process = ScriptedPopen(successful_messages(stop_reason="cancelled"))
        with self.assertRaisesRegex(bridge.KimiBridgeError, "did not complete"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_a_reverse_permission_request(self) -> None:
        messages = successful_messages()
        messages[3:5] = [{
            "jsonrpc": "2.0",
            "id": 99,
            "method": "session/request_permission",
            "params": {"sessionId": "session-1"},
        }]
        process = ScriptedPopen(messages)
        with self.assertRaisesRegex(bridge.KimiBridgeError, "interactive permission"):
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
                with self.assertRaisesRegex(bridge.KimiBridgeError, expected):
                    self.run_with(process)
                self.assertTrue(process.stdin.closed_by_driver)

    def test_rejects_peer_notification_flood_before_deadline(self) -> None:
        noise = {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": "unrelated", "update": {}},
        }
        process = ScriptedPopen([noise] * (bridge._MAX_PEER_EVENT_COUNT + 1) + successful_messages())
        with self.assertRaisesRegex(bridge.KimiBridgeError, "peer event budget exceeded"):
            self.run_with(process)
        self.assertTrue(process.stdin.closed_by_driver)


if __name__ == "__main__":
    unittest.main()
