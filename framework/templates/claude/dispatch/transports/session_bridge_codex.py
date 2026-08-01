#!/usr/bin/env python3
"""Codex App Server implementation for a native same-root-session bridge.

The App Server's ``thread/fork`` creates a related *new* session in current
Codex releases.  It is therefore deliberately not treated as a same-session
subagent path. This driver instead starts one non-ephemeral root thread and
requires that root turn to use Codex's native ``spawnAgent`` collaboration
tool. The App Server emits a collab item carrying the parent thread, child
thread, call ID, prompt and terminal child state, which is the lineage this
bridge validates. No shipped manifest marks this driver verified until a real
App Server installation emits that lifecycle in an isolated probe.

Only opaque identifiers and terminal states leave this module.  Prompts,
model text, raw App Server messages, and stderr remain in memory.  Production
callers pass ``command=[\"codex\", \"app-server\", \"--stdio\"]``; tests inject a
``popen``-compatible factory.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from typing import Any, Protocol


# This identifies an App Server capability, not a Codex product.  A future
# CLI that provides the same verified collaboration wire contract can reuse
# this driver by declaring this protocol kind in its bridge manifest.
BRIDGE_KIND = "app-server-native-agent/v1"
_TERMINAL_TURN_STATUSES = {"completed", "failed", "interrupted"}
_TERMINAL_COLLAB_STATUSES = {"completed", "failed"}
_TERMINAL_AGENT_STATUSES = {"completed", "interrupted", "errored", "shutdown", "notFound"}
_NONCE_PREFIX = "HARNESS_SUBAGENT_NONCE:"
_MAX_PEER_EVENT_BYTES = 1_048_576
_MAX_PEER_EVENT_COUNT = 1_024
_MAX_PEER_TOTAL_BYTES = 8 * 1_048_576
_EOF = object()


class CodexSessionBridgeError(RuntimeError):
    """The App Server could not prove a native same-root-session child."""


class CodexSessionBridgeTimeout(CodexSessionBridgeError):
    """The shared bridge deadline elapsed before a required protocol event."""


# The generic bridge runner imports this concise public category.  Keep the
# specific name above for callers that need to distinguish Codex failures.
CodexBridgeError = CodexSessionBridgeError


class SessionBridgeTransport(Protocol):
    """Small injectable transport surface used by ``run_codex_native_agent``."""

    def send(self, message: Mapping[str, Any]) -> None:
        """Write one JSON object to the App Server NDJSON stream."""

    def receive(self, timeout_s: float) -> Mapping[str, Any] | None:
        """Return one decoded NDJSON object, or ``None`` when no line arrived."""

    def close(self) -> None:
        """Release the transport and any child process it owns."""


class _SubprocessTransport:
    """Line-oriented stdio transport that keeps App Server stderr drained."""

    def __init__(
        self,
        command: list[str],
        cwd: str,
        popen: Callable[..., Any],
    ) -> None:
        try:
            self._process = popen(
                command,
                cwd=cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except OSError as exc:
            raise CodexSessionBridgeError("could not start the App Server") from exc

        if self._process.stdin is None or self._process.stdout is None or self._process.stderr is None:
            self._process.kill()
            self._process.wait()
            raise CodexSessionBridgeError("App Server stdio is unavailable")

        self._events: queue.Queue[object] = queue.Queue()
        self._closed = False
        self._stdout_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()

    def _read_stdout(self) -> None:
        assert self._process.stdout is not None
        event_count = 0
        total_bytes = 0
        try:
            while True:
                # Bound readline itself as well as the retained queue. A peer
                # that withholds a newline must not create one giant string.
                line = self._process.stdout.readline(_MAX_PEER_EVENT_BYTES + 1)
                if line == "":
                    break
                line_bytes = len(line.encode("utf-8", errors="replace"))
                if line_bytes > _MAX_PEER_EVENT_BYTES:
                    self._events.put(CodexSessionBridgeError("App Server update exceeds the bridge size limit"))
                    return
                if event_count >= _MAX_PEER_EVENT_COUNT or total_bytes + line_bytes > _MAX_PEER_TOTAL_BYTES:
                    self._events.put(CodexSessionBridgeError("App Server peer event budget exceeded"))
                    return
                event_count += 1
                total_bytes += line_bytes
                self._events.put(line)
        finally:
            self._events.put(_EOF)

    def _drain_stderr(self) -> None:
        # The bridge never stores or returns provider output.  Draining avoids
        # a verbose App Server stderr pipe blocking the protocol process.
        assert self._process.stderr is not None
        for _line in self._process.stderr:
            pass

    def send(self, message: Mapping[str, Any]) -> None:
        if self._closed or self._process.poll() is not None:
            raise CodexSessionBridgeError("App Server is not running")
        assert self._process.stdin is not None
        try:
            self._process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            self._process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise CodexSessionBridgeError("could not write to the App Server") from exc

    def receive(self, timeout_s: float) -> Mapping[str, Any] | None:
        try:
            line = self._events.get(timeout=max(0.0, timeout_s))
        except queue.Empty:
            return None
        if isinstance(line, CodexSessionBridgeError):
            raise line
        if line is _EOF:
            raise CodexSessionBridgeError("App Server closed before the bridge finished")
        if not isinstance(line, str):
            raise CodexSessionBridgeError("App Server produced an invalid stream event")
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CodexSessionBridgeError("App Server produced invalid NDJSON") from exc
        if not isinstance(message, dict):
            raise CodexSessionBridgeError("App Server NDJSON message must be an object")
        return message

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._process.stdin is not None:
            try:
                self._process.stdin.close()
            except OSError:
                pass
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=1)


def _nonempty_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise CodexSessionBridgeError(f"App Server {field} is missing")
    return value


def _thread(result: Mapping[str, Any], stage: str) -> Mapping[str, Any]:
    value = result.get("thread")
    if not isinstance(value, dict):
        raise CodexSessionBridgeError(f"App Server {stage} response is missing thread")
    return value


def _turn_id(result: Mapping[str, Any], stage: str) -> str:
    value = result.get("turn")
    if not isinstance(value, dict):
        raise CodexSessionBridgeError(f"App Server {stage} response is missing turn")
    return _nonempty_string(value.get("id"), f"{stage} turn id")


def _verify_child_lineage(
    child: Mapping[str, Any],
    *,
    child_thread_id: str,
    parent_thread_id: str,
    session_id: str,
) -> None:
    """Prove the native child belongs to this App Server session tree."""
    if child.get("id") != child_thread_id:
        raise CodexSessionBridgeError("App Server child read did not return the spawned thread")
    if child.get("parentThreadId") != parent_thread_id:
        raise CodexSessionBridgeError("App Server child thread is not linked to the parent thread")
    if child.get("sessionId") != session_id:
        raise CodexSessionBridgeError("App Server child thread is not in the parent session tree")
    source = child.get("source")
    if not isinstance(source, dict):
        raise CodexSessionBridgeError("App Server child thread source is missing")
    subagent = source.get("subAgent")
    if not isinstance(subagent, dict):
        raise CodexSessionBridgeError("App Server child thread is not a native subagent")
    thread_spawn = subagent.get("thread_spawn")
    if not isinstance(thread_spawn, dict) or thread_spawn.get("parent_thread_id") != parent_thread_id:
        raise CodexSessionBridgeError("App Server child thread spawn lineage is invalid")


def _bridge_instruction_file(cwd: str) -> str:
    """Create a fixed instruction file for an isolated HOME App Server run.

    A user-level Codex config may contain a path such as
    ``~/.codex/instructions.md``.  In the Harness sandbox ``HOME`` intentionally
    points at a dedicated empty directory, so resolving that user path would
    either fail or force us to expose the real home directory.  Override only
    this path with a fixed, worktree-local file and remove it after the bridge;
    authentication continues to come from the configured ``CODEX_HOME``.
    """
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=cwd,
            prefix=".harness-codex-bridge-",
            suffix=".md",
            delete=False,
        ) as stream:
            stream.write(
                "You are executing inside a Harness same-root-session bridge. "
                "Follow the task supplied in the active turn; do not commit, "
                "push, deploy, or access production.\n"
            )
            return stream.name
    except OSError as exc:
        raise CodexSessionBridgeError("could not create the isolated App Server instruction file") from exc


def _command_with_instruction_override(command: list[str], instruction_file: str) -> list[str]:
    # ``-c key=value`` takes a TOML value.  JSON produces a compatible quoted
    # basic string and avoids shell interpolation because Popen receives argv.
    override = f"model_instructions_file={json.dumps(instruction_file)}"
    effective = list(command)
    try:
        stdio_index = effective.index("--stdio")
    except ValueError:
        effective.extend(["-c", override])
    else:
        effective[stdio_index:stdio_index] = ["-c", override]
    return effective


class _ProtocolSession:
    def __init__(self, transport: SessionBridgeTransport, deadline: float) -> None:
        self._transport = transport
        self._deadline = deadline
        self._next_request_id = 1
        self._notifications: deque[Mapping[str, Any]] = deque()

    def _remaining(self) -> float:
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise CodexSessionBridgeTimeout("App Server native bridge deadline elapsed")
        return remaining

    def _receive(self) -> Mapping[str, Any]:
        while True:
            message = self._transport.receive(self._remaining())
            if message is not None:
                return message
            # A mock transport may return immediately instead of waiting. Keep
            # its idle path bounded without turning it into a CPU spin loop.
            time.sleep(min(0.01, self._remaining()))

    @staticmethod
    def _reject_server_request(message: Mapping[str, Any]) -> None:
        # This bridge never answers App Server approvals or input elicitations.
        # Automatic acceptance would silently broaden the caller's authority.
        if (
            "id" in message
            and isinstance(message.get("method"), str)
            and "result" not in message
            and "error" not in message
        ):
            raise CodexSessionBridgeError("App Server requested interactive approval")

    def notify(self, method: str, params: Mapping[str, Any]) -> None:
        self._transport.send({"method": method, "params": dict(params)})

    def request(self, method: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
        request_id = self._next_request_id
        self._next_request_id += 1
        self._transport.send({"id": request_id, "method": method, "params": dict(params)})
        while True:
            message = self._receive()
            self._reject_server_request(message)
            if "id" in message:
                response_id = message["id"]
                # ``bool`` is a subclass of ``int`` and ``1.0 == 1`` in
                # Python, but neither is a valid match for our generated
                # integer App Server request id.
                if type(response_id) is not int:
                    raise CodexSessionBridgeError("App Server response id must be an integer")
                if response_id != request_id:
                    raise CodexSessionBridgeError("App Server response id did not match the bridge request")
                if "error" in message:
                    raise CodexSessionBridgeError(f"App Server rejected {method}")
                result = message.get("result")
                if not isinstance(result, dict):
                    raise CodexSessionBridgeError(f"App Server {method} response is invalid")
                return result
            self._notifications.append(message)

    def _next_notification(self) -> Mapping[str, Any]:
        if self._notifications:
            return self._notifications.popleft()
        return self._receive()

    @staticmethod
    def _collab_child(
        item: Mapping[str, Any], parent_thread_id: str, marker: str
    ) -> tuple[str, str]:
        if item.get("type") != "collabAgentToolCall" or item.get("tool") != "spawnAgent":
            raise CodexSessionBridgeError("App Server native child event is invalid")
        call_id = _nonempty_string(item.get("id"), "native child call id")
        if item.get("senderThreadId") != parent_thread_id:
            raise CodexSessionBridgeError("App Server native child is not linked to the parent thread")
        receivers = item.get("receiverThreadIds")
        if not isinstance(receivers, list) or len(receivers) != 1:
            raise CodexSessionBridgeError("App Server native child must have exactly one child thread")
        child_thread_id = _nonempty_string(receivers[0], "native child thread id")
        if child_thread_id == parent_thread_id:
            raise CodexSessionBridgeError("App Server native child must have a distinct child thread")
        prompt = item.get("prompt")
        if not isinstance(prompt, str) or marker not in prompt:
            raise CodexSessionBridgeError("App Server native child did not receive the bridge nonce")
        return call_id, child_thread_id

    @staticmethod
    def _child_completed(item: Mapping[str, Any]) -> bool:
        if item.get("status") != "completed":
            return False
        states = item.get("agentsStates")
        if not isinstance(states, dict) or not states:
            return False
        for state in states.values():
            if not isinstance(state, dict) or state.get("status") != "completed":
                return False
        return True

    def await_native_child(
        self,
        parent_thread_id: str,
        parent_turn_id: str,
        nonce: str,
    ) -> tuple[str, str, str]:
        """Require exactly one completed native child in this root turn."""
        marker = f"{_NONCE_PREFIX}{nonce}"
        child_call_id: str | None = None
        child_thread_id: str | None = None
        child_completed = False

        while True:
            message = self._next_notification()
            self._reject_server_request(message)
            method = message.get("method")
            params = message.get("params")
            if not isinstance(params, dict):
                continue
            if params.get("threadId") != parent_thread_id:
                continue

            if method in {"item/started", "item/completed"}:
                if params.get("turnId") != parent_turn_id:
                    continue
                item = params.get("item")
                if not isinstance(item, dict) or item.get("type") != "collabAgentToolCall":
                    continue
                if item.get("tool") != "spawnAgent":
                    continue
                call_id, child_thread = self._collab_child(item, parent_thread_id, marker)
                if child_call_id is None:
                    child_call_id, child_thread_id = call_id, child_thread
                elif call_id != child_call_id or child_thread != child_thread_id:
                    raise CodexSessionBridgeError("App Server root turn started more than one native child")
                if method == "item/completed":
                    if item.get("status") not in _TERMINAL_COLLAB_STATUSES:
                        raise CodexSessionBridgeError("App Server native child returned an unknown terminal status")
                    if not self._child_completed(item):
                        raise CodexSessionBridgeError("App Server native child did not complete")
                    child_completed = True
                continue

            if method != "turn/completed":
                continue
            turn = params.get("turn")
            if not isinstance(turn, dict) or turn.get("id") != parent_turn_id:
                continue
            status = _nonempty_string(turn.get("status"), "root turn completion status")
            if status not in _TERMINAL_TURN_STATUSES:
                raise CodexSessionBridgeError("App Server reported an unknown root turn terminal status")
            if status != "completed":
                raise CodexSessionBridgeError("App Server root turn did not complete")
            if child_call_id is None or child_thread_id is None or not child_completed:
                raise CodexSessionBridgeError("App Server root turn completed without a verified native child")
            return status, child_call_id, child_thread_id


def _validate_inputs(
    command: list[str],
    cwd: str,
    prompt: str,
    nonce: str,
    timeout_s: int | float,
) -> None:
    if not isinstance(command, list) or not command or any(
        not isinstance(part, str) or not part for part in command
    ):
        raise ValueError("command must be a non-empty list of non-empty strings")
    if not isinstance(cwd, str) or not cwd or not os.path.isdir(cwd):
        raise ValueError("cwd must be an existing directory")
    if not isinstance(prompt, str) or not prompt:
        raise ValueError("prompt must be a non-empty string")
    if not isinstance(nonce, str) or len(nonce) < 16:
        raise ValueError("nonce must be a non-empty bridge nonce")
    if isinstance(timeout_s, bool) or not isinstance(timeout_s, (int, float)) or timeout_s <= 0:
        raise ValueError("timeout_s must be a positive number")


def run_codex_native_agent(
    command: list[str],
    cwd: str,
    prompt: str,
    nonce: str,
    timeout_s: int,
    *,
    popen: Callable[..., Any] = subprocess.Popen,
) -> dict[str, str]:
    """Run one verified Codex native child inside a non-ephemeral root session.

    The supplied root prompt commissions exactly one native child whose prompt
    includes the random ``nonce``.  The App Server item lifecycle binds the
    child call and receiver thread to the root turn.  A related ``thread/fork``
    is intentionally not accepted because it has a distinct session ID in
    current Codex releases.
    """
    _validate_inputs(command, cwd, prompt, nonce, timeout_s)
    instruction_file = _bridge_instruction_file(cwd)
    transport = _SubprocessTransport(
        _command_with_instruction_override(list(command), instruction_file), cwd, popen
    )
    session = _ProtocolSession(transport, time.monotonic() + float(timeout_s))
    try:
        session.request(
            "initialize",
            {
                "clientInfo": {
                    "name": "harness-session-bridge",
                    "version": "1",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        session.notify("initialized", {})

        root_result = session.request(
            "thread/start",
            {
                "cwd": cwd,
                "sandbox": "workspace-write",
                "approvalPolicy": "never",
                "ephemeral": False,
            },
        )
        root = _thread(root_result, "thread/start")
        parent_thread_id = _nonempty_string(root.get("id"), "parent thread id")
        session_id = _nonempty_string(root.get("sessionId"), "parent session id")
        if root.get("ephemeral") is not False:
            raise CodexSessionBridgeError("App Server root thread must be non-ephemeral")

        parent_turn_id = _turn_id(
            session.request(
                "turn/start",
                {
                    "threadId": parent_thread_id,
                    "input": [{"type": "text", "text": prompt}],
                },
            ),
            "root turn/start",
        )
        terminal_status, child_call_id, child_thread_id = session.await_native_child(
            parent_thread_id, parent_turn_id, nonce
        )
        child = _thread(
            session.request("thread/read", {"threadId": child_thread_id}),
            "thread/read",
        )
        _verify_child_lineage(
            child,
            child_thread_id=child_thread_id,
            parent_thread_id=parent_thread_id,
            session_id=session_id,
        )
        return {
            "bridge_kind": BRIDGE_KIND,
            "parent_thread_id": parent_thread_id,
            "parent_turn_id": parent_turn_id,
            "child_call_id": child_call_id,
            "child_thread_id": child_thread_id,
            "session_id": session_id,
            "terminal_status": terminal_status,
        }
    finally:
        transport.close()
        try:
            os.unlink(instruction_file)
        except FileNotFoundError:
            pass
        except OSError:
            # The process result must not be upgraded to success if cleanup
            # fails, but the worktree is disposable and the sandbox caller
            # will retain it for failure forensics.
            pass
