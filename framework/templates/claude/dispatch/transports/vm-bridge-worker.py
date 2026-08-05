#!/usr/bin/env python3
"""Guest-side supervisor staged exclusively by ``vm-bridge-provider.py``.

This program is not a public dispatch entrypoint. It runs inside a provider
copy-in VM workspace, starts the protocol runner in one owned process group,
and returns only its constrained receipt file to the provider's copy-out pipe.
It deliberately receives no host checkout, host HOME, host credentials, or
durable Harness state.
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import hashlib
import json
import os
import pwd
import re
import signal
import stat
import subprocess
import sys
import tarfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
LAUNCH_NONCE = re.compile(r"^[0-9a-f]{32}$")
TARGET_FIELDS = {
    "target_id",
    "integration_id",
    "tool",
    "invocation",
    "model_family",
    "priority",
    "roles",
    "adapter",
    "sandbox",
    "timeout_s",
    "agent_type",
    "native_agent_type",
    "deliverable_channel",
    "bridge_id",
    "bridge_strategy",
    "session_scope",
    "bridge_protocol",
    "bridge_provider_id",
    "bridge_provider_kind",
    "bridge_provider_contract_sha256",
    "adapter_execution_contract_sha256",
    "capabilities",
    "execution_provenance_sha256",
}
PROTOCOL_FIELDS = {"kind", "command", "request_delivery", "response_format"}
MAX_COPYOUT_FILES = 10_000
MAX_COPYOUT_BYTES = 64 * 1024 * 1024
MAX_BRIDGE_RESULT_BYTES = 4 * 1024
WORKER_USER = "harnessvm"
ROOT_UID = 0
ROOT_GID = 0
BRIDGE_RESULT_FIELDS = {
    "bridge_id",
    "bridge_strategy",
    "bridge_kind",
    "session_scope",
    "session_id_sha256",
    "nonce_sha256",
    "child_call_id_sha256",
    "subagent_type",
    "terminal_status",
    "provider_launch_attestation_sha256",
    "artifact_sha256",
}


class WorkerError(ValueError):
    pass


@dataclass(frozen=True)
class WorkerIdentity:
    uid: int
    gid: int


@dataclass(frozen=True)
class GuestLayout:
    guest_root: Path
    worktree: Path
    state_root: Path
    target: Path
    envelope: Path
    receipt: Path


def _private_mode(entry: os.stat_result) -> bool:
    return stat.S_IMODE(entry.st_mode) & 0o077 == 0


def _directory_entry(path: Path, label: str) -> os.stat_result:
    try:
        entry = path.lstat()
    except OSError as exc:
        raise WorkerError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
        raise WorkerError(f"{label} is invalid")
    return entry


def _owned_private_directory(path: Path, label: str, uid: int, gid: int) -> os.stat_result:
    entry = _directory_entry(path, label)
    if entry.st_uid != uid or entry.st_gid != gid or not _private_mode(entry):
        raise WorkerError(f"{label} ownership or mode is invalid")
    return entry


def _owned_guarded_directory(path: Path, label: str, uid: int, gid: int) -> os.stat_result:
    entry = _directory_entry(path, label)
    if entry.st_uid != uid or entry.st_gid != gid or stat.S_IMODE(entry.st_mode) & 0o022:
        raise WorkerError(f"{label} ownership or mode is invalid")
    return entry


def _owned_regular_file(path: Path, label: str, uid: int, gid: int) -> os.stat_result:
    entry = _regular_file(path, label)
    if entry.st_uid != uid or entry.st_gid != gid or stat.S_IMODE(entry.st_mode) & 0o022:
        raise WorkerError(f"{label} ownership or mode is invalid")
    return entry


def _require_root() -> None:
    if os.name != "posix" or os.geteuid() != ROOT_UID:
        raise WorkerError("VM bridge supervisor must run as root")


def _worker_identity() -> WorkerIdentity:
    try:
        entry = pwd.getpwnam(WORKER_USER)
    except KeyError as exc:
        raise WorkerError("VM worker identity is unavailable") from exc
    if entry.pw_name != WORKER_USER or entry.pw_uid <= 0 or entry.pw_gid <= 0:
        raise WorkerError("VM worker identity is invalid")
    return WorkerIdentity(uid=entry.pw_uid, gid=entry.pw_gid)


def _same_path(left: Path, right: Path) -> bool:
    return left.absolute() == right.absolute()


def _guest_layout(args: argparse.Namespace, identity: WorkerIdentity) -> GuestLayout:
    """Validate the fixed provider-owned guest layout before using it.

    The root supervisor accepts no caller-selected result location.  Source and
    state are the only harnessvm-owned directories; the receipt is a distinct
    root-only path under their common per-job parent.
    """
    worktree = args.worktree.absolute()
    state_root = args.worker_state_root.absolute()
    target = args.target.absolute()
    envelope = args.envelope.absolute()
    receipt = args.receipt.absolute()
    if worktree.name != "source" or state_root.name != "state":
        raise WorkerError("guest source or state path is invalid")
    guest_root = worktree.parent
    if not _same_path(state_root.parent, guest_root):
        raise WorkerError("guest state path is outside the job root")
    expected_receipt = guest_root / "receipt" / "bridge-result.json"
    if not _same_path(receipt, expected_receipt):
        raise WorkerError("bridge receipt path is invalid")
    if not _same_path(target, guest_root / ".harness-target.json"):
        raise WorkerError("guest target path is invalid")
    if not _same_path(envelope, guest_root / ".harness-envelope.json"):
        raise WorkerError("guest envelope path is invalid")

    _owned_guarded_directory(guest_root, "guest job root", ROOT_UID, ROOT_GID)
    _owned_private_directory(worktree, "guest source", identity.uid, identity.gid)
    _owned_private_directory(state_root, "guest worker state", identity.uid, identity.gid)
    _owned_private_directory(receipt.parent, "guest receipt directory", ROOT_UID, ROOT_GID)
    _owned_regular_file(target, "guest target", ROOT_UID, ROOT_GID)
    _owned_regular_file(envelope, "guest envelope", ROOT_UID, ROOT_GID)
    if receipt.exists() or receipt.is_symlink():
        raise WorkerError("bridge receipt already exists")
    return GuestLayout(
        guest_root=guest_root,
        worktree=worktree,
        state_root=state_root,
        target=target,
        envelope=envelope,
        receipt=receipt,
    )


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise WorkerError(f"{label} is unreadable") from exc
    if not isinstance(value, dict):
        raise WorkerError(f"{label} must be an object")
    return value


def safe_relative_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        raise WorkerError(f"{label} is invalid")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise WorkerError(f"{label} is invalid")
    return value


def _regular_file(path: Path, label: str) -> os.stat_result:
    """Open only ordinary unlinked-in-name files from the worker tree.

    The child has already exited before this supervisor command starts, but
    preserving the no-link/no-special-file rule here avoids treating that
    lifecycle assumption as a filesystem authorization primitive.
    """
    try:
        entry = path.lstat()
    except OSError as exc:
        raise WorkerError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
        raise WorkerError(f"{label} must be an unlinked regular file")
    return entry


def _relative_tree_files(root: Path) -> list[tuple[str, Path, os.stat_result]]:
    """Enumerate a source tree without following worker-created links."""
    try:
        root_entry = root.lstat()
    except OSError as exc:
        raise WorkerError("worker source tree is unavailable") from exc
    if stat.S_ISLNK(root_entry.st_mode) or not stat.S_ISDIR(root_entry.st_mode):
        raise WorkerError("worker source tree is invalid")

    result: list[tuple[str, Path, os.stat_result]] = []

    def visit(directory: Path, prefix: str) -> None:
        try:
            entries = sorted(os.scandir(directory), key=lambda item: item.name)
        except OSError as exc:
            raise WorkerError("worker source tree is unreadable") from exc
        for entry in entries:
            name = entry.name
            if not name or name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
                raise WorkerError("worker source tree contains an unsafe path")
            relative = f"{prefix}/{name}" if prefix else name
            if len(relative) > 512:
                raise WorkerError("worker source tree path is too long")
            try:
                metadata = entry.stat(follow_symlinks=False)
            except OSError as exc:
                raise WorkerError("worker source tree entry is unreadable") from exc
            path = Path(entry.path)
            if stat.S_ISLNK(metadata.st_mode):
                raise WorkerError("worker source tree may not contain symlinks")
            if stat.S_ISDIR(metadata.st_mode):
                visit(path, relative)
                continue
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise WorkerError("worker source tree contains an unsupported file")
            result.append((relative, path, metadata))

    visit(root, "")
    if len(result) > MAX_COPYOUT_FILES:
        raise WorkerError("worker source tree exceeds the copy-out file limit")
    return result


def copyout(args: argparse.Namespace) -> int:
    """Stream only a normalized result receipt and ordinary source files.

    This runs in a separate provider-owned systemd cgroup after the bridge
    unit has been reaped. It never asks Git to interpret worker-writable
    configuration, attributes, filters, or hooks.
    """
    _require_root()
    identity = _worker_identity()
    artifact = safe_relative_path(args.artifact, "commissioned artifact")
    source_root = args.worktree.absolute()
    receipt = args.receipt.absolute()
    if source_root.name != "source":
        raise WorkerError("worker source path is invalid")
    guest_root = source_root.parent
    expected_receipt = guest_root / "receipt" / "bridge-result.json"
    if not _same_path(receipt, expected_receipt):
        raise WorkerError("bridge receipt path is invalid")
    _owned_guarded_directory(guest_root, "guest job root", ROOT_UID, ROOT_GID)
    _owned_private_directory(source_root, "worker source tree", identity.uid, identity.gid)
    _owned_private_directory(receipt.parent, "guest receipt directory", ROOT_UID, ROOT_GID)
    receipt_stat = _owned_regular_file(receipt, "bridge result", ROOT_UID, ROOT_GID)
    entries = _relative_tree_files(source_root)
    paths = {relative for relative, _path, _metadata in entries}
    if artifact not in paths:
        raise WorkerError("worker source tree lacks the commissioned artifact")

    total = receipt_stat.st_size
    for _relative, _path, metadata in entries:
        total += metadata.st_size
        if total > MAX_COPYOUT_BYTES:
            raise WorkerError("worker source tree exceeds the copy-out size limit")

    try:
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz", format=tarfile.PAX_FORMAT) as archive:
            for arcname, path, metadata in [("receipt/bridge-result.json", receipt, receipt_stat), *[
                (f"source/{relative}", path, metadata) for relative, path, metadata in entries
            ]]:
                # Re-open with O_NOFOLLOW after the lstat check. The child cgroup
                # has already been reaped, and this closes the remaining leaf
                # replacement edge without retaining worker metadata in the tar.
                descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                try:
                    opened = os.fstat(descriptor)
                    if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or opened.st_size != metadata.st_size:
                        raise WorkerError("worker source changed during copy-out")
                    info = tarfile.TarInfo(arcname)
                    info.size = opened.st_size
                    # The provider needs Git-visible executable state to
                    # reconcile source safely, but no worker-owned ownership,
                    # set-id, or group/world permission metadata.
                    info.mode = 0o600 if arcname.startswith("state/") else (
                        0o700 if opened.st_mode & 0o111 else 0o600
                    )
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = 0
                    with os.fdopen(descriptor, "rb", closefd=False) as stream:
                        archive.addfile(info, stream)
                finally:
                    os.close(descriptor)
    except (OSError, tarfile.TarError) as exc:
        raise WorkerError("worker copy-out stream failed") from exc
    return 0


def target_from(path: Path, role: str) -> dict[str, Any]:
    target = load_json(path, "target")
    if set(target) != TARGET_FIELDS:
        raise WorkerError("target shape is invalid")
    if target.get("invocation") != "subagent" or target.get("session_scope") != "same-session":
        raise WorkerError("target is not a same-session subagent")
    for key in ("target_id", "bridge_id", "bridge_strategy", "agent_type", "native_agent_type"):
        if not isinstance(target.get(key), str) or SAFE_ID.fullmatch(target[key]) is None:
            raise WorkerError(f"target {key} is invalid")
    if target.get("deliverable_channel") not in {"file", "terminal-message"}:
        raise WorkerError("target deliverable_channel is invalid")
    if target.get("bridge_provider_id") != "harness-vm-v1" or target.get("bridge_provider_kind") != "vm-v1":
        raise WorkerError("target is not bound to vm-v1")
    for key in (
        "bridge_provider_contract_sha256",
        "adapter_execution_contract_sha256",
        "execution_provenance_sha256",
    ):
        if not isinstance(target.get(key), str) or SHA256.fullmatch(target[key]) is None:
            raise WorkerError(f"target {key} is invalid")
    if not isinstance(target.get("roles"), list) or role not in target["roles"]:
        raise WorkerError("target does not allow the envelope role")
    protocol = target.get("bridge_protocol")
    if not isinstance(protocol, dict) or set(protocol) != PROTOCOL_FIELDS:
        raise WorkerError("target bridge protocol is invalid")
    if (
        protocol.get("kind") != "acp-native-agent/v1"
        or protocol.get("request_delivery") != "stdin"
        or protocol.get("response_format") != "json"
        or not isinstance(protocol.get("command"), list)
        or not protocol["command"]
        or any(not isinstance(item, str) or not item for item in protocol["command"])
    ):
        raise WorkerError("target bridge protocol is invalid")
    return target


def _create_worker_state_directory(
    state_root: Path, name: str, identity: WorkerIdentity
) -> Path:
    path = state_root / name
    if path.exists() or path.is_symlink():
        raise WorkerError("provider worker state is not empty")
    try:
        path.mkdir(mode=0o700)
        os.chown(path, identity.uid, identity.gid)
    except OSError as exc:
        raise WorkerError("provider worker state could not be prepared") from exc
    _owned_private_directory(path, "provider worker state directory", identity.uid, identity.gid)
    return path


def provider_environment(
    state_root: Path, timeout_s: int, identity: WorkerIdentity
) -> dict[str, str]:
    """Construct the only vendor environment permitted inside the guest."""
    launch_nonce = os.environ.get("HARNESS_PROVIDER_LAUNCH_NONCE", "")
    launch_attestation = os.environ.get("HARNESS_PROVIDER_LAUNCH_ATTESTATION_SHA256", "")
    broker_base_url = os.environ.get("HARNESS_PROVIDER_BROKER_BASE_URL", "")
    broker_lease = os.environ.get("HARNESS_PROVIDER_BROKER_LEASE", "")
    if LAUNCH_NONCE.fullmatch(launch_nonce) is None:
        raise WorkerError("provider launch nonce is invalid")
    if SHA256.fullmatch(launch_attestation) is None:
        raise WorkerError("provider launch attestation is invalid")
    if not broker_base_url.startswith("http://") or len(broker_base_url) > 512:
        raise WorkerError("provider broker endpoint is invalid")
    if not isinstance(broker_lease, str) or len(broker_lease) < 32 or len(broker_lease) > 256:
        raise WorkerError("provider broker lease is invalid")
    home = _create_worker_state_directory(state_root, "home", identity)
    kimi_home = _create_worker_state_directory(state_root, "kimi-code", identity)
    temporary = _create_worker_state_directory(state_root, "tmp", identity)
    return {
        "HOME": str(home),
        "TMPDIR": str(temporary),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "KIMI_CODE_HOME": str(kimi_home),
        "KIMI_DISABLE_TELEMETRY": "1",
        "KIMI_DISABLE_CRON": "1",
        "KIMI_CODE_NO_AUTO_UPDATE": "1",
        "KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT": "0",
        "KIMI_MODEL_NAME": "kimi-for-coding",
        "KIMI_MODEL_PROVIDER_TYPE": "kimi",
        "KIMI_MODEL_BASE_URL": broker_base_url,
        "KIMI_MODEL_API_KEY": broker_lease,
        "KIMI_MODEL_MAX_CONTEXT_SIZE": "262144",
        "KIMI_MODEL_CAPABILITIES": "thinking",
        "KIMI_SUBAGENT_TIMEOUT_MS": str(max(1, timeout_s) * 1000),
        "HARNESS_PROVIDER_LAUNCH_NONCE": launch_nonce,
        "HARNESS_PROVIDER_LAUNCH_ATTESTATION_SHA256": launch_attestation,
    }


def _owned_process_group(process: subprocess.Popen[str]) -> int:
    if os.name != "posix":
        raise WorkerError("VM bridge supervisor requires POSIX process groups")
    pid = getattr(process, "pid", None)
    if type(pid) is not int or pid <= 0:
        raise WorkerError("provider bridge process identity is invalid")
    try:
        if os.getpgid(pid) != pid:
            raise WorkerError("provider bridge process group is not isolated")
    except OSError as exc:
        raise WorkerError("provider bridge process group is unavailable") from exc
    return pid


def _group_exists(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError as exc:
        raise WorkerError("provider bridge process group cannot be reaped") from exc


def reap_group(process: subprocess.Popen[str], process_group: int) -> None:
    """Reap the verified bridge process group before consuming its result.

    A successful session bridge can have already exited while a vendor helper
    still holds the result-pipe write end.  Always signal and observe the
    verified process group before reading that pipe; ``Popen.poll`` only tells
    us about the group leader and is not a completion proof for its children.
    The outer ``systemd-run --wait --collect`` cgroup provides containment for
    descendants that leave this process group, including a ``setsid`` escape.
    """
    try:
        os.killpg(process_group, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass

    deadline = time.monotonic() + 2
    while _group_exists(process_group):
        if time.monotonic() >= deadline:
            try:
                os.killpg(process_group, signal.SIGKILL)
            except ProcessLookupError:
                return
            kill_deadline = time.monotonic() + 2
            while _group_exists(process_group):
                if time.monotonic() >= kill_deadline:
                    raise WorkerError("provider bridge process group did not exit")
                time.sleep(0.02)
            return
        time.sleep(0.02)


def _write_all(descriptor: int, payload: bytes, label: str) -> None:
    offset = 0
    while offset < len(payload):
        try:
            written = os.write(descriptor, payload[offset:])
        except InterruptedError:
            continue
        except (BlockingIOError, BrokenPipeError) as exc:
            raise WorkerError(f"{label} is unavailable") from exc
        if written <= 0:
            raise WorkerError(f"{label} is unavailable")
        offset += written


def _result_json(value: dict[str, Any]) -> bytes:
    try:
        payload = json.dumps(
            value, ensure_ascii=True, sort_keys=True, separators=(",", ":")
        ).encode("utf-8") + b"\n"
    except (TypeError, ValueError) as exc:
        raise WorkerError("bridge result cannot be serialized") from exc
    if not payload or len(payload) > MAX_BRIDGE_RESULT_BYTES:
        raise WorkerError("bridge result exceeds the size limit")
    return payload


def _no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise WorkerError("bridge result contains duplicate keys")
        result[key] = value
    return result


def _read_result_pipe(descriptor: int) -> dict[str, Any]:
    payload = bytearray()
    while True:
        try:
            block = os.read(descriptor, MAX_BRIDGE_RESULT_BYTES + 1 - len(payload))
        except InterruptedError:
            continue
        except BlockingIOError as exc:
            # Every child in the verified group has been reaped. A still-open
            # writer is an unexpected descriptor leak, not an invitation to
            # consume a mutable result later.
            raise WorkerError("bridge result pipe did not close") from exc
        if not block:
            break
        payload.extend(block)
        if len(payload) > MAX_BRIDGE_RESULT_BYTES:
            raise WorkerError("bridge result exceeds the size limit")
    if not payload:
        raise WorkerError("bridge result pipe is empty")
    try:
        decoded = payload.decode("utf-8")
        value = json.loads(decoded, object_pairs_hook=_no_duplicate_object)
    except WorkerError:
        raise
    except (UnicodeError, ValueError) as exc:
        raise WorkerError("bridge result is invalid JSON") from exc
    if not isinstance(value, dict):
        raise WorkerError("bridge result must be an object")
    return value


def _artifact_from_worktree(
    worktree: Path, relative: str, identity: WorkerIdentity
) -> Path:
    candidate = worktree
    parts = relative.split("/")
    for index, part in enumerate(parts):
        candidate = candidate / part
        if index < len(parts) - 1:
            _owned_private_directory(
                candidate, "commissioned artifact parent", identity.uid, identity.gid
            )
    _owned_regular_file(candidate, "commissioned artifact", identity.uid, identity.gid)
    return candidate


def _same_commissioned_artifact(
    expected: os.stat_result, observed: os.stat_result, identity: WorkerIdentity
) -> bool:
    """Compare an opened artifact against the trusted path snapshot."""
    return (
        stat.S_ISREG(observed.st_mode)
        and observed.st_nlink == 1
        and observed.st_uid == identity.uid
        and observed.st_gid == identity.gid
        and not stat.S_IMODE(observed.st_mode) & 0o022
        and observed.st_dev == expected.st_dev
        and observed.st_ino == expected.st_ino
        and observed.st_size == expected.st_size
        and observed.st_mtime_ns == expected.st_mtime_ns
        and observed.st_ctime_ns == expected.st_ctime_ns
    )


def _commissioned_artifact_sha256(path: Path, identity: WorkerIdentity) -> str:
    """Hash one bounded, stable worker-owned artifact without pathname reads."""
    expected = _owned_regular_file(path, "commissioned artifact", identity.uid, identity.gid)
    if expected.st_size > MAX_COPYOUT_BYTES:
        raise WorkerError("commissioned artifact exceeds the copy-out size limit")
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if type(nofollow) is not int or nofollow == 0:
        raise WorkerError("commissioned artifact no-follow open is unavailable")
    try:
        descriptor = os.open(
            path,
            os.O_RDONLY | nofollow | getattr(os, "O_CLOEXEC", 0),
        )
    except OSError as exc:
        raise WorkerError("commissioned artifact is unreadable") from exc
    try:
        opened = os.fstat(descriptor)
        if not _same_commissioned_artifact(expected, opened, identity):
            raise WorkerError("commissioned artifact changed before digest")
        digest = hashlib.sha256()
        consumed = 0
        while consumed < MAX_COPYOUT_BYTES:
            try:
                block = os.read(descriptor, min(64 * 1024, MAX_COPYOUT_BYTES - consumed))
            except InterruptedError:
                continue
            except OSError as exc:
                raise WorkerError("commissioned artifact is unreadable") from exc
            if not block:
                break
            consumed += len(block)
            digest.update(block)
        final = os.fstat(descriptor)
        if (
            not _same_commissioned_artifact(expected, final, identity)
            or consumed != final.st_size
        ):
            raise WorkerError("commissioned artifact changed during digest")
        return digest.hexdigest()
    except OSError as exc:
        raise WorkerError("commissioned artifact is unreadable") from exc
    finally:
        os.close(descriptor)


def _validate_result(
    value: dict[str, Any],
    *,
    target: dict[str, Any],
    envelope: dict[str, Any],
    worktree: Path,
    identity: WorkerIdentity,
    worker_env: dict[str, str],
) -> dict[str, Any]:
    if set(value) != BRIDGE_RESULT_FIELDS:
        raise WorkerError("bridge result shape is invalid")
    protocol = target["bridge_protocol"]
    expected = {
        "bridge_id": target["bridge_id"],
        "bridge_strategy": target["bridge_strategy"],
        "bridge_kind": protocol["kind"],
        "session_scope": "same-session",
        "subagent_type": target["native_agent_type"],
        "terminal_status": "completed",
        "provider_launch_attestation_sha256": worker_env[
            "HARNESS_PROVIDER_LAUNCH_ATTESTATION_SHA256"
        ],
    }
    for field, expected_value in expected.items():
        if value.get(field) != expected_value:
            raise WorkerError("bridge result is not bound to the launch")
    nonce = worker_env["HARNESS_PROVIDER_LAUNCH_NONCE"]
    if value.get("nonce_sha256") != hashlib.sha256(nonce.encode("ascii")).hexdigest():
        raise WorkerError("bridge result nonce is invalid")
    for field in (
        "session_id_sha256",
        "nonce_sha256",
        "child_call_id_sha256",
        "provider_launch_attestation_sha256",
        "artifact_sha256",
    ):
        item = value.get(field)
        if not isinstance(item, str) or SHA256.fullmatch(item) is None:
            raise WorkerError("bridge result contains an invalid digest")
    deliverable = envelope.get("deliverable")
    assert isinstance(deliverable, dict)
    artifact = _artifact_from_worktree(
        worktree, safe_relative_path(deliverable.get("artifact"), "envelope artifact"), identity
    )
    digest = _commissioned_artifact_sha256(artifact, identity)
    if value["artifact_sha256"] != digest:
        raise WorkerError("bridge result artifact binding is invalid")
    return dict(value)


def _write_root_receipt(path: Path, value: dict[str, Any]) -> None:
    _owned_private_directory(path.parent, "guest receipt directory", ROOT_UID, ROOT_GID)
    if path.exists() or path.is_symlink():
        raise WorkerError("bridge receipt already exists")
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            0o600,
        )
    except OSError as exc:
        raise WorkerError("bridge receipt cannot be created") from exc
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or opened.st_uid != ROOT_UID
            or opened.st_gid != ROOT_GID
            or stat.S_IMODE(opened.st_mode) != 0o600
        ):
            raise WorkerError("bridge receipt ownership or mode is invalid")
        _write_all(descriptor, _result_json(value), "bridge receipt")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _owned_regular_file(path, "bridge receipt", ROOT_UID, ROOT_GID)


def _pipe() -> tuple[int, int]:
    flags = getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        return os.pipe2(flags)
    except AttributeError:
        read_fd, write_fd = os.pipe()
        for descriptor in (read_fd, write_fd):
            current = fcntl.fcntl(descriptor, fcntl.F_GETFD)
            fcntl.fcntl(descriptor, fcntl.F_SETFD, current | fcntl.FD_CLOEXEC)
        return read_fd, write_fd


def run(args: argparse.Namespace) -> int:
    _require_root()
    identity = _worker_identity()
    layout = _guest_layout(args, identity)
    envelope = load_json(layout.envelope, "envelope")
    role = envelope.get("role")
    if role not in {"planner", "generator", "evaluator"}:
        raise WorkerError("envelope role is invalid")
    deliverable = envelope.get("deliverable")
    if not isinstance(deliverable, dict):
        raise WorkerError("envelope deliverable is invalid")
    safe_relative_path(deliverable.get("artifact"), "envelope artifact")
    target = target_from(layout.target, role)
    bridge = Path(__file__).absolute().parent / "session-bridge.py"
    _owned_regular_file(bridge, "staged bridge runner", ROOT_UID, ROOT_GID)
    worker_env = provider_environment(layout.state_root, args.timeout_s, identity)
    read_fd, write_fd = _pipe()
    process: subprocess.Popen[str] | None = None
    process_group: int | None = None
    previous: dict[int, Any] = {}
    try:
        command = [
            sys.executable,
            "-I",
            str(bridge),
            "run",
            "--bridge-id", target["bridge_id"],
            "--strategy", target["bridge_strategy"],
            "--protocol-json", json.dumps(target["bridge_protocol"], separators=(",", ":")),
            "--persona", target["agent_type"],
            "--native-agent-type", target["native_agent_type"],
            "--deliverable-channel", target["deliverable_channel"],
            "--envelope", str(layout.envelope),
            "--worktree", str(layout.worktree),
            "--result-fd", str(write_fd),
            "--timeout-s", str(args.timeout_s),
            "--worker-state-root", str(layout.state_root),
        ]
        try:
            process = subprocess.Popen(
                command,
                cwd=str(layout.worktree),
                env=worker_env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                start_new_session=True,
                close_fds=True,
                pass_fds=(write_fd,),
            )
        finally:
            os.close(write_fd)
            write_fd = -1
        process_group = _owned_process_group(process)

        def cancelled(_signal: int, _frame: Any) -> None:
            assert process is not None and process_group is not None
            reap_group(process, process_group)
            raise WorkerError("provider worker was cancelled")

        for item in (signal.SIGTERM, signal.SIGINT):
            previous[item] = signal.signal(item, cancelled)
        try:
            try:
                exit_code = process.wait(timeout=max(1, args.timeout_s))
            except subprocess.TimeoutExpired as exc:
                raise WorkerError("provider worker timed out") from exc
        finally:
            # This happens before the result pipe is read, including when the
            # root bridge itself returned successfully.
            reap_group(process, process_group)
        if exit_code != 0:
            raise WorkerError("provider bridge runner failed")
        result = _read_result_pipe(read_fd)
        validated = _validate_result(
            result,
            target=target,
            envelope=envelope,
            worktree=layout.worktree,
            identity=identity,
            worker_env=worker_env,
        )
        _write_root_receipt(layout.receipt, validated)
        return 0
    finally:
        if write_fd >= 0:
            os.close(write_fd)
        os.close(read_fd)
        for item, handler in previous.items():
            signal.signal(item, handler)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    run_parser = commands.add_parser("run")
    run_parser.add_argument("--target", required=True, type=Path)
    run_parser.add_argument("--envelope", required=True, type=Path)
    run_parser.add_argument("--worktree", required=True, type=Path)
    run_parser.add_argument("--worker-state-root", required=True, type=Path)
    run_parser.add_argument("--receipt", required=True, type=Path)
    run_parser.add_argument("--timeout-s", required=True, type=int)
    copyout_parser = commands.add_parser("copyout")
    copyout_parser.add_argument("--worktree", required=True, type=Path)
    copyout_parser.add_argument("--receipt", required=True, type=Path)
    copyout_parser.add_argument("--artifact", required=True)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "run":
            if isinstance(args.timeout_s, bool) or not 1 <= args.timeout_s <= 86_400:
                raise WorkerError("timeout is invalid")
            return run(args)
        if args.command == "copyout":
            return copyout(args)
        raise WorkerError("worker command is invalid")
    except WorkerError as exc:
        # Do not surface guest prompts, vendor output, broker lease values, or
        # paths in a receipt. The provider maps this category to run-meta.
        print(f"[vm-bridge-worker] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
