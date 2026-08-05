#!/usr/bin/env python3
"""Kimi ACP implementation for the Harness same-session bridge.

This module deliberately records only protocol facts.  ACP messages, prompts,
model text, and tool output stay in memory and must never be copied to a
bridge receipt or a dispatch log.
"""

from __future__ import annotations

import hashlib
import json
import os
import pwd
import queue
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


_MAX_PEER_EVENT_BYTES = 1_048_576
_MAX_PEER_EVENT_COUNT = 1_024
_MAX_PEER_TOTAL_BYTES = 8 * 1_048_576
_MAX_RAW_CHILD_CALL_ID_CHARS = 512
# These values are persisted into run-meta. ACP display strings and arbitrary
# JSON values are never lineage identifiers, even if they happen to be strings.
_LINEAGE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_LAUNCH_NONCE = re.compile(r"^[0-9a-f]{32}$")
_WORKER_USER = "harnessvm"
_SETPRIV = "/usr/bin/setpriv"

# The provider constructs this complete worker environment.  The ACP process
# never inherits ``os.environ`` and cannot receive a host credential, loader,
# or an arbitrary KIMI_* setting through this module.
_WORKER_ENV_ALLOWLIST = frozenset({
    "HOME",
    "TMPDIR",
    "PATH",
    "LANG",
    "LC_ALL",
    "KIMI_CODE_HOME",
    "KIMI_DISABLE_TELEMETRY",
    "KIMI_DISABLE_CRON",
    "KIMI_CODE_NO_AUTO_UPDATE",
    "KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT",
    "KIMI_MODEL_NAME",
    "KIMI_MODEL_API_KEY",
    "KIMI_MODEL_PROVIDER_TYPE",
    "KIMI_MODEL_BASE_URL",
    "KIMI_MODEL_MAX_CONTEXT_SIZE",
    "KIMI_MODEL_CAPABILITIES",
    "KIMI_SUBAGENT_TIMEOUT_MS",
    "KIMI_BASE_URL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
})
_REQUIRED_WORKER_ENV = frozenset({"HOME", "TMPDIR"})


class KimiBridgeError(RuntimeError):
    """The ACP peer did not prove a native child-agent execution."""


@dataclass(frozen=True)
class _WorkerIdentity:
    uid: int
    gid: int


def _harnessvm_identity() -> _WorkerIdentity:
    """Return the one unprivileged identity allowed to execute vendor code."""
    if os.name != "posix" or os.geteuid() != 0:
        raise KimiBridgeError("Kimi provider bridge must run as root before dropping privileges")
    try:
        entry = pwd.getpwnam(_WORKER_USER)
    except KeyError as exc:
        raise KimiBridgeError("Kimi provider worker identity is unavailable") from exc
    if entry.pw_name != _WORKER_USER or entry.pw_uid <= 0 or entry.pw_gid <= 0:
        raise KimiBridgeError("Kimi provider worker identity is invalid")
    return _WorkerIdentity(uid=entry.pw_uid, gid=entry.pw_gid)


def _harnessvm_command(command: list[str], identity: _WorkerIdentity | None) -> list[str]:
    """Wrap a vendor command in the guest's fixed privilege-drop utility.

    Python's ``Popen(user=...)`` is not portable across all hardened guest
    ELF launch paths. The pinned Ubuntu guest provides ``/usr/bin/setpriv``;
    invoke it by absolute path so it performs the identity transition before
    the vendor binary starts. The outer systemd profile already owns the
    complete cgroup and grants only the two transition capabilities to this
    root bridge.
    """
    if identity is None:
        return list(command)
    return [
        _SETPRIV,
        f"--reuid={identity.uid}",
        f"--regid={identity.gid}",
        "--clear-groups",
        "--inh-caps=-all",
        "--ambient-caps=-all",
        "--no-new-privs",
        "--",
        *command,
    ]


def _inside(root: Path, candidate: Path) -> bool:
    try:
        return os.path.commonpath((str(root), str(candidate))) == str(root)
    except ValueError:
        return False


def _private_worker_directory(
    path: Path, root: Path, identity: _WorkerIdentity, label: str
) -> Path:
    if not path.is_absolute():
        raise KimiBridgeError(f"{label} must be absolute")
    try:
        entry = path.lstat()
    except OSError as exc:
        raise KimiBridgeError(f"{label} is unavailable") from exc
    if (
        stat.S_ISLNK(entry.st_mode)
        or not stat.S_ISDIR(entry.st_mode)
        or entry.st_uid != identity.uid
        or entry.st_gid != identity.gid
        or stat.S_IMODE(entry.st_mode) & 0o077
    ):
        raise KimiBridgeError(f"{label} ownership or mode is invalid")
    resolved = path.resolve()
    if resolved == root or not _inside(root, resolved):
        raise KimiBridgeError(f"{label} escapes the worker state root")
    return resolved


def _provider_worker_environment(
    worker_env: Mapping[str, str],
    worker_state_root: Path | None,
    identity: _WorkerIdentity | None = None,
) -> tuple[dict[str, str], Path]:
    """Build an empty per-launch Kimi state home from provider-owned inputs.

    The provider owns authentication, network egress, and the VM lifecycle.
    This driver receives only its explicit, bounded worker environment and a
    writable state root inside that worker.  It must never inspect or copy the
    Coordinator's KIMI_CODE_HOME, credentials, OAuth state, or host environment.
    """
    if worker_state_root is None:
        raise KimiBridgeError("Kimi ACP bridge requires a provider worker state root")
    if not isinstance(worker_env, Mapping):
        raise KimiBridgeError("Kimi ACP bridge requires a provider worker environment")
    environment: dict[str, str] = {}
    for key, value in worker_env.items():
        if not isinstance(key, str) or key not in _WORKER_ENV_ALLOWLIST:
            raise KimiBridgeError("Kimi provider worker environment contains an unsupported key")
        if not isinstance(value, str) or not value or "\x00" in value:
            raise KimiBridgeError("Kimi provider worker environment value is invalid")
        environment[key] = value
    if not _REQUIRED_WORKER_ENV.issubset(environment):
        raise KimiBridgeError("Kimi provider worker environment is incomplete")
    try:
        root_stat = worker_state_root.lstat()
        if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
            raise KimiBridgeError("Kimi provider worker state root is invalid")
        root = worker_state_root.resolve()
        if identity is not None:
            if (
                root_stat.st_uid != identity.uid
                or root_stat.st_gid != identity.gid
                or stat.S_IMODE(root_stat.st_mode) & 0o077
            ):
                raise KimiBridgeError("Kimi provider worker state root ownership or mode is invalid")
            for key in ("HOME", "TMPDIR"):
                _private_worker_directory(Path(environment[key]), root, identity, f"Kimi provider {key}")
        requested_home = environment.get("KIMI_CODE_HOME")
        if requested_home is None:
            if identity is not None:
                raise KimiBridgeError("Kimi provider KIMI_CODE_HOME must be pre-created")
            private_home = Path(tempfile.mkdtemp(prefix="kimi-code-", dir=root))
        else:
            candidate = Path(requested_home)
            try:
                candidate_stat = candidate.lstat()
            except OSError as exc:
                raise KimiBridgeError("Kimi provider KIMI_CODE_HOME must be a pre-created directory") from exc
            if stat.S_ISLNK(candidate_stat.st_mode) or not stat.S_ISDIR(candidate_stat.st_mode):
                raise KimiBridgeError("Kimi provider KIMI_CODE_HOME is invalid")
            if identity is not None:
                private_home = _private_worker_directory(
                    candidate, root, identity, "Kimi provider KIMI_CODE_HOME"
                )
            else:
                if not candidate.is_absolute():
                    raise KimiBridgeError("Kimi provider KIMI_CODE_HOME must be absolute")
                private_home = candidate.resolve()
                if private_home == root or not _inside(root, private_home):
                    raise KimiBridgeError("Kimi provider KIMI_CODE_HOME escapes the worker state root")
            if any(private_home.iterdir()):
                raise KimiBridgeError("Kimi provider KIMI_CODE_HOME must be empty at launch")
        os.chmod(private_home, 0o700)
    except KimiBridgeError:
        raise
    except OSError as exc:
        raise KimiBridgeError("Kimi ephemeral bridge state could not be created") from exc
    environment["KIMI_CODE_HOME"] = str(private_home)
    return environment, private_home


def _remove_ephemeral_kimi_state(private_home: Path | None) -> None:
    if private_home is None:
        return
    try:
        if private_home.is_symlink():
            raise KimiBridgeError("Kimi ephemeral bridge state was replaced by a symlink")
        if private_home.exists():
            shutil.rmtree(private_home)
        if private_home.exists() or private_home.is_symlink():
            raise KimiBridgeError("Kimi ephemeral bridge state cleanup was incomplete")
    except KimiBridgeError:
        raise
    except OSError as exc:
        raise KimiBridgeError("Kimi ephemeral bridge state cleanup failed") from exc


def _owned_process_group(process: subprocess.Popen[str]) -> int | None:
    """Return this bridge's dedicated POSIX process group, if proven safe."""
    if os.name != "posix":
        return None
    pid = getattr(process, "pid", None)
    if type(pid) is not int or pid <= 0:
        return None
    try:
        return pid if os.getpgid(pid) == pid else None
    except OSError:
        return None


def _group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # A bridge-owned group should never become inaccessible. Treat this as
        # still alive so its cleanup cannot be mistaken for a success.
        return True


def _terminate_process(
    process: subprocess.Popen[str],
    process_group: int | None,
    *,
    outer_group_owns_cleanup: bool = False,
) -> None:
    """Close the ACP server and every child it could have started.

    Kimi currently runs native Agents in-process, but that is an implementation
    detail rather than a harness guarantee. Direct protocol fixtures create and
    reap a dedicated POSIX session. A real provider owns the complete VM job
    tree and may keep reaping authority outside this worker.
    """
    if outer_group_owns_cleanup:
        # The strict provider owns this bridge's VM job tree. If stdin close
        # did not make ACP exit, return and let that provider reap the worker
        # without granting the vendor process broad host signal authority.
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            return
        return

    if process_group is None:
        if process.poll() is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            process.wait(timeout=2)
        return

    try:
        os.killpg(process_group, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        # The group is still authoritative even if its leader has already
        # exited.  Kill it as a group rather than only reaping the leader.
        try:
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)

    deadline = time.monotonic() + 2
    while _group_exists(process_group):
        if time.monotonic() >= deadline:
            try:
                os.killpg(process_group, signal.SIGKILL)
            except ProcessLookupError:
                pass
            if _group_exists(process_group):
                raise KimiBridgeError("Kimi ACP process group did not exit")
            return
        time.sleep(0.02)


def _kill_owned_process_group_immediately(process_group: int | None) -> None:
    """Kill only the ACP session this bridge proved it owns.

    This is used only by the direct-driver path, where the driver created the
    dedicated session itself. On cancellation the outer timeout helper can
    terminate this bridge before normal ``finally`` cleanup runs, so a signal
    handler must synchronously reap that proven group first. Never fall back
    to the caller's group or a process-group lookup derived from peer data.
    """
    if process_group is None:
        return
    try:
        os.killpg(process_group, signal.SIGKILL)
    except ProcessLookupError:
        pass


@dataclass
class _InterruptCleanup:
    """Cancellation state installed before an ACP process exists.

    In direct mode, a POSIX signal can arrive after ``Popen`` has created the
    child session but before Python has recovered and verified its process
    group. The handler records that narrow window and applies it once the only
    safe target is known. In contained mode no target is bound: the outer
    timeout helper owns cancellation and reaping.
    """

    process_group: int | None = None
    pending_signal: int | None = None
    previous: dict[int, Any] | None = None

    def bind_process_group(self, process_group: int | None) -> None:
        self.process_group = process_group

    def raise_if_interrupted(self) -> None:
        if self.pending_signal is None:
            return
        _kill_owned_process_group_immediately(self.process_group)
        raise KimiBridgeError("Kimi ACP bridge interrupted")


def _install_interrupt_cleanup() -> _InterruptCleanup:
    """Install cleanup before spawning so the child-group binding cannot race."""
    cleanup = _InterruptCleanup(previous={})
    if os.name != "posix" or threading.current_thread() is not threading.main_thread():
        return cleanup

    def interrupted(signum: int, _frame: Any) -> None:
        cleanup.pending_signal = signum
        if cleanup.process_group is None:
            # Popen may already have created the dedicated session. Do not
            # raise until the caller can bind its verified group, otherwise a
            # narrow signal window would still orphan it.
            return
        # Do not wait in a signal handler. The outer helper has a short grace
        # period and this group may contain an uncooperative native child.
        _kill_owned_process_group_immediately(cleanup.process_group)
        raise KimiBridgeError("Kimi ACP bridge interrupted")

    assert cleanup.previous is not None
    for handled in (signal.SIGTERM, signal.SIGINT):
        cleanup.previous[handled] = signal.signal(handled, interrupted)
    return cleanup


def _restore_interrupt_handlers(cleanup: _InterruptCleanup) -> None:
    for handled, handler in (cleanup.previous or {}).items():
        signal.signal(handled, handler)


@dataclass
class _RpcPeer:
    process: subprocess.Popen[str]
    deadline: float
    next_id: int = 1

    def __post_init__(self) -> None:
        if self.process.stdout is None:
            raise KimiBridgeError("ACP stdio is unavailable")
        self._events: queue.Queue[object] = queue.Queue()
        threading.Thread(target=self._read_stdout, daemon=True).start()

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        event_count = 0
        total_bytes = 0
        try:
            while True:
                # Bound readline itself as well as the retained queue. A peer
                # that withholds a newline must not create one giant string.
                raw = self.process.stdout.readline(_MAX_PEER_EVENT_BYTES + 1)
                if raw == "":
                    break
                raw_bytes = len(raw.encode("utf-8", errors="replace"))
                if raw_bytes > _MAX_PEER_EVENT_BYTES:
                    self._events.put(KimiBridgeError("ACP update exceeds the bridge size limit"))
                    return
                if event_count >= _MAX_PEER_EVENT_COUNT or total_bytes + raw_bytes > _MAX_PEER_TOTAL_BYTES:
                    self._events.put(KimiBridgeError("ACP peer event budget exceeded"))
                    return
                event_count += 1
                total_bytes += raw_bytes
                self._events.put(raw)
        finally:
            self._events.put(None)

    def _receive(self) -> dict[str, Any]:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise KimiBridgeError("ACP bridge deadline expired")
        try:
            raw = self._events.get(timeout=remaining)
        except queue.Empty as exc:
            raise KimiBridgeError("ACP bridge deadline expired") from exc
        if isinstance(raw, KimiBridgeError):
            raise raw
        if raw is None:
            raise KimiBridgeError("ACP exited before replying")
        if not isinstance(raw, str):
            raise KimiBridgeError("ACP returned an invalid stream event")
        try:
            message = json.loads(raw)
        except ValueError as exc:
            raise KimiBridgeError("ACP returned invalid JSON-RPC") from exc
        if not isinstance(message, dict):
            raise KimiBridgeError("ACP returned a non-object message")
        return message

    def request(self, method: str, params: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        ident = self.next_id
        self.next_id += 1
        line = json.dumps(
            {"jsonrpc": "2.0", "id": ident, "method": method, "params": params},
            ensure_ascii=True,
            separators=(",", ":"),
        )
        if self.process.stdin is None or self.process.stdout is None:
            raise KimiBridgeError("ACP stdio is unavailable")
        try:
            self.process.stdin.write(line + "\n")
            self.process.stdin.flush()
        except OSError as exc:
            raise KimiBridgeError("ACP request could not be sent") from exc

        notices: list[dict[str, Any]] = []
        while True:
            message = self._receive()
            if "id" in message and isinstance(message.get("method"), str):
                # ACP permits reverse RPC for permission/elicitation. The
                # Harness never auto-answers it: the configured auto mode is
                # the only execution authority inside the sandbox boundary.
                raise KimiBridgeError("ACP requested an interactive permission or input")
            if "id" in message:
                response_id = message["id"]
                # ``bool`` is a subclass of ``int`` and ``1.0 == 1`` in
                # Python, but neither is a valid match for our generated
                # integer JSON-RPC request id.
                if type(response_id) is not int:
                    raise KimiBridgeError("ACP response id must be an integer")
                if response_id != ident:
                    raise KimiBridgeError("ACP response id did not match the bridge request")
                if "error" in message:
                    raise KimiBridgeError("ACP rejected a bridge request")
                result = message.get("result")
                if not isinstance(result, dict):
                    raise KimiBridgeError("ACP request result was not an object")
                return result, notices
            notices.append(message)
        raise KimiBridgeError("ACP bridge deadline expired")

def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _lineage_id(value: Any) -> str | None:
    return value if isinstance(value, str) and _LINEAGE_IDENTIFIER.fullmatch(value) else None


def _peer_child_call_id(value: Any) -> str | None:
    """Accept bounded wire IDs only in memory, never as durable text.

    ACP defines the child call id as a composite vendor identifier and does not
    guarantee a portable character grammar. It is necessary to compare the
    raw value across updates, but it must not be copied into a receipt where a
    hostile peer could turn it into a text-exfiltration field.
    """
    if not isinstance(value, str) or not value or len(value) > _MAX_RAW_CHILD_CALL_ID_CHARS:
        return None
    return None if any(
        ord(character) < 32
        or ord(character) == 127
        or 0xD800 <= ord(character) <= 0xDFFF
        for character in value
    ) else value


def _receipt_child_call_id(raw_call_id: str) -> str:
    """Return a non-reversible receipt token for an ACP-controlled call id."""
    try:
        encoded = raw_call_id.encode("utf-8")
    except UnicodeError as exc:
        raise KimiBridgeError("ACP tool-call identifier is invalid") from exc
    return hashlib.sha256(encoded).hexdigest()


def _receipt_identifier(value: str) -> str:
    """Return a non-reversible receipt token for a bounded ACP identifier."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _agent_tool_event(message: dict[str, Any], session_id: str) -> tuple[str | None, dict[str, Any], str | None]:
    """Normalize ACP tool-call updates without trusting vendor text fields.

    Kimi has evolved its visual update keys between releases.  The stable proof
    is an initial ``Agent`` tool call, a nonce-bearing rawInput update, and a
    terminal status on that same call ID. Kimi 0.31 emits those facts across
    separate updates, and the rawInput update changes the display title. Accept
    the documented aliases only; do not infer child execution from the root
    final answer.
    """
    if message.get("method") != "session/update":
        return None, {}, None
    params = _object(message.get("params"))
    if params.get("sessionId") != session_id:
        return None, {}, None
    update = _object(params.get("update"))
    kind = update.get("sessionUpdate") or update.get("type")
    if kind not in {"tool_call", "tool_call_update", "tool"}:
        return None, {}, None
    tool_name = update.get("title") or update.get("toolName") or update.get("name")
    raw_input = _object(update.get("rawInput") or update.get("input"))
    raw_call_id = update.get("toolCallId") or update.get("tool_call_id") or update.get("id")
    call_id = _peer_child_call_id(raw_call_id)
    if raw_call_id is not None and call_id is None:
        raise KimiBridgeError("ACP tool-call identifier is invalid")
    return tool_name if isinstance(tool_name, str) else None, raw_input, call_id


def _agent_message_text(message: dict[str, Any], session_id: str) -> str:
    """Extract root assistant text from one session update, else empty string.

    Used only for the terminal-message deliverable channel: read-only vendor
    personas cannot write the commissioned artifact, so the driver
    materializes the root session's relayed deliverable itself (FIX2 #1:A).
    Kimi 0.31 streams these as ``agent_message_chunk`` content blocks.
    """
    if message.get("method") != "session/update":
        return ""
    params = _object(message.get("params"))
    if params.get("sessionId") != session_id:
        return ""
    update = _object(params.get("update"))
    kind = update.get("sessionUpdate") or update.get("type")
    if kind not in {"agent_message_chunk", "agent_message"}:
        return ""
    content = update.get("content")
    blocks = content if isinstance(content, list) else [content]
    collected: list[str] = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            collected.append(block["text"])
    return "".join(collected)


_DELIVERABLE_SINK_MAX_BYTES = 1024 * 1024


def _materialize_terminal_message(sink: Path, updates: list[dict[str, Any]], session_id: str) -> None:
    """Write the root session's relayed deliverable to the artifact path."""
    text = "".join(_agent_message_text(update, session_id) for update in updates)
    if not text.strip():
        raise KimiBridgeError("Kimi bridge returned no terminal-message deliverable")
    payload = text.encode("utf-8")
    if len(payload) > _DELIVERABLE_SINK_MAX_BYTES:
        raise KimiBridgeError("Kimi bridge terminal-message deliverable exceeds its size limit")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        sink.parent.mkdir(parents=True, exist_ok=True)
        # The commissioned artifact must be owned by the worktree principal
        # (the vendor uid), not by whichever uid runs the driver. Under the
        # root-supervisor model the driver is root while the worktree belongs
        # to the dropped vendor account, so mirror the parent's ownership.
        parent_stat = os.stat(sink.parent)
        descriptor = os.open(str(sink), flags, 0o600)
    except OSError as exc:
        raise KimiBridgeError("Kimi bridge could not materialize the terminal-message deliverable") from exc
    try:
        os.write(descriptor, payload)
        if os.geteuid() == 0 and (parent_stat.st_uid != 0 or parent_stat.st_gid != 0):
            os.fchown(descriptor, parent_stat.st_uid, parent_stat.st_gid)
    finally:
        os.close(descriptor)


def _agent_completion_event(message: dict[str, Any], session_id: str, call_id: str) -> bool:
    if message.get("method") != "session/update":
        return False
    params = _object(message.get("params"))
    if params.get("sessionId") != session_id:
        return False
    update = _object(params.get("update"))
    kind = update.get("sessionUpdate") or update.get("type")
    if kind not in {"tool_call", "tool_call_update", "tool"}:
        return False
    raw_call_id = update.get("toolCallId") or update.get("tool_call_id") or update.get("id")
    event_call_id = _peer_child_call_id(raw_call_id)
    if raw_call_id is not None and event_call_id is None:
        raise KimiBridgeError("ACP tool-call identifier is invalid")
    if event_call_id != call_id:
        return False
    status = update.get("status")
    # ACP tool_call_update normally carries only the call id and new status;
    # it need not repeat the original Agent title or rawInput.  The earlier
    # call-id/nonce match is the identity proof, so accept its terminal update
    # without depending on vendor display fields being repeated.
    return status in {"completed", "complete", "success"}


def run_acp_native_agent(
    command: list[str],
    cwd: str,
    prompt: str,
    nonce: str,
    subagent_type: str,
    timeout_s: int,
    *,
    popen: Callable[..., subprocess.Popen[str]] = subprocess.Popen,
    worker_env: Mapping[str, str],
    worker_state_root: Path | None,
    provider_owns_cleanup: bool = False,
    run_as_harnessvm: bool = False,
    deliverable_sink: Path | None = None,
) -> dict[str, Any]:
    """Run one native Kimi Agent and prove it happened through ACP updates.

    ``command`` is manifest-owned and has already passed catalog validation.
    The caller supplies a finite task timeout; this function still applies an
    in-process deadline so a malformed peer cannot outlive the sandbox helper.
    """
    if not command or any(not isinstance(item, str) or not item for item in command):
        raise KimiBridgeError("Kimi ACP command is invalid")
    if subagent_type not in {"plan", "coder", "explore"}:
        raise KimiBridgeError("Kimi native subagent type is invalid")
    if not isinstance(nonce, str) or _LAUNCH_NONCE.fullmatch(nonce) is None:
        raise KimiBridgeError("Kimi bridge nonce is invalid")
    if type(run_as_harnessvm) is not bool:
        raise KimiBridgeError("Kimi provider privilege mode is invalid")

    interrupt_cleanup = _install_interrupt_cleanup()
    process: subprocess.Popen[str] | None = None
    process_group: int | None = None
    private_kimi_home: Path | None = None
    try:
        # A cancellation which arrived while handlers were being installed
        # must prevent a later Popen from starting an unnecessary CLI session.
        interrupt_cleanup.raise_if_interrupted()
        identity = _harnessvm_identity() if run_as_harnessvm else None
        environment, private_kimi_home = _provider_worker_environment(
            worker_env,
            worker_state_root,
            identity,
        )
        interrupt_cleanup.raise_if_interrupted()
        try:
            popen_options: dict[str, Any] = {
                "cwd": cwd,
                "stdin": subprocess.PIPE,
                "stdout": subprocess.PIPE,
                # ACP's wire protocol is stdout-only. Vendor stderr is neither
                # a protocol channel nor an allowed diagnostic sink, and line
                # iteration can allocate an unbounded string before yielding.
                "stderr": subprocess.DEVNULL,
                "text": True,
                "bufsize": 1,
                "env": environment,
                # A root session bridge may hold the supervisor result pipe.
                # Never allow the vendor process to inherit it or any other
                # incidental descriptor from the trusted parent.
                "close_fds": True,
            }
            if identity is not None:
                # ``setpriv`` applies the uid/gid transition inside the
                # pinned guest before the vendor ELF runs. Keep the bridge
                # process root-owned until that exact wrapper executes.
                popen_options["umask"] = 0o077
            if os.name == "posix" and not provider_owns_cleanup:
                popen_options["start_new_session"] = True
            process = popen(_harnessvm_command(command, identity), **popen_options)
        except OSError as exc:
            raise KimiBridgeError("Kimi ACP command could not start") from exc

        process_group = None if provider_owns_cleanup else _owned_process_group(process)
        # Direct callers must prove a dedicated session; falling back to a
        # single-PID cleanup could strand native children. The contained path
        # intentionally has no dedicated group because the outer helper owns
        # the complete bridge process tree.
        if (
            os.name == "posix"
            and not provider_owns_cleanup
            and type(getattr(process, "pid", None)) is int
            and process_group is None
        ):
            raise KimiBridgeError("Kimi ACP dedicated process group is not verifiable")
        interrupt_cleanup.bind_process_group(process_group)
        # If SIGTERM/SIGINT landed between Popen and this binding, recover the
        # dedicated group synchronously before any peer thread can start.
        interrupt_cleanup.raise_if_interrupted()
        deadline = time.monotonic() + max(1, timeout_s)
        peer = _RpcPeer(process, deadline)
        initialized, _ = peer.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {},
                "clientInfo": {"name": "harness-session-bridge", "version": "1"},
            },
        )
        if initialized.get("protocolVersion") != 1:
            raise KimiBridgeError("Kimi ACP protocol version is unsupported")
        created, _ = peer.request("session/new", {"cwd": os.path.abspath(cwd), "mcpServers": []})
        session_id = _lineage_id(created.get("sessionId"))
        if session_id is None:
            raise KimiBridgeError("Kimi ACP did not return a session id")

        # Kimi ACP exposes tool approval as reverse RPC.  A same-session child
        # cannot wait for an interactive IDE user, so set the documented ACP
        # mode explicitly. The process still has only the Harness's dedicated
        # HOME, filtered credentials, isolated worktree, disabled push,
        # host write containment, and outer wall-clock cap; a reverse
        # permission request remains fail-closed.
        peer.request(
            "session/set_config_option",
            {"sessionId": session_id, "configId": "mode", "value": "auto"},
        )

        # ACP session/prompt streams session/update notifications before its
        # response.  The response's stopReason is the terminal root-turn
        # signal; waiting for a made-up terminal notification after it would
        # deadlock valid ACP peers that correctly send no such event.
        acknowledged, initial_updates = peer.request(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": prompt}],
            },
        )
        if acknowledged.get("stopReason") not in {"end_turn", "completed"}:
            raise KimiBridgeError("Kimi ACP did not complete the bridge prompt")
        updates = list(initial_updates)

        agent_call_ids: set[str] = set()
        raw_inputs: dict[str, dict[str, Any]] = {}
        for update in updates:
            tool_name, raw_input, call_id = _agent_tool_event(update, session_id)
            # A swarm fans out unbounded child work outside the one-child
            # receipt contract. Do not turn an observed swarm event into a
            # generic tool update: fail the bridge before it can be accepted.
            if tool_name == "AgentSwarm":
                raise KimiBridgeError("Kimi ACP native AgentSwarm is not permitted")
            if call_id is None:
                continue
            if tool_name == "Agent":
                agent_call_ids.add(call_id)
            if raw_input:
                raw_inputs[call_id] = raw_input
        if len(agent_call_ids) != 1:
            raise KimiBridgeError("Kimi ACP did not prove exactly one native Agent call")
        child_call_id = next(iter(agent_call_ids))
        raw_input = raw_inputs.get(child_call_id, {})
        if raw_input.get("description") != f"harness-child:{nonce}":
            raise KimiBridgeError("Kimi ACP did not prove a matching native Agent call")
        if raw_input.get("subagent_type") != subagent_type:
            raise KimiBridgeError("Kimi ACP native Agent type did not match the bridge persona")
        if not any(_agent_completion_event(update, session_id, child_call_id) for update in updates):
            raise KimiBridgeError("Kimi ACP native Agent did not reach completion")
        if deliverable_sink is not None:
            _materialize_terminal_message(deliverable_sink, updates, session_id)
        return {
            "bridge_kind": "acp-native-agent/v1",
            "session_id_sha256": _receipt_identifier(session_id),
            "nonce_sha256": _receipt_identifier(nonce),
            # The raw ACP ID is used only for in-memory event correlation.
            # The receipt field is a fixed-size digest, never vendor text.
            "child_call_id_sha256": _receipt_child_call_id(child_call_id),
            "subagent_type": subagent_type,
            "terminal_status": "completed",
        }
    finally:
        try:
            if process is not None and process.stdin is not None:
                try:
                    process.stdin.close()
                except OSError:
                    pass
            if process is not None:
                _terminate_process(
                    process,
                    process_group,
                    outer_group_owns_cleanup=provider_owns_cleanup,
                )
                # Do not let a late signal interrupt private-state deletion.
                # In contained mode the outer helper still owns and reports
                # the original cancellation.
                interrupt_cleanup.bind_process_group(None)
        finally:
            try:
                _remove_ephemeral_kimi_state(private_kimi_home)
            finally:
                _restore_interrupt_handlers(interrupt_cleanup)


# Keep the old public symbol as a narrow compatibility shim for focused ACP
# fixtures. The protocol-driven bridge runner uses ``run_acp_native_agent`` so
# future CLI manifests are never selected by tool name.
run_kimi_acp_native_agent = run_acp_native_agent
