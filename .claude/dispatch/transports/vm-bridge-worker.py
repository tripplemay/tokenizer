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
import json
import os
import re
import signal
import stat
import subprocess
import sys
import tarfile
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


class WorkerError(ValueError):
    pass


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
    artifact = safe_relative_path(args.artifact, "commissioned artifact")
    source_root = args.worktree.resolve()
    state_root = args.worker_state_root.resolve()
    receipt = state_root / "bridge-result.json"
    if not state_root.is_dir():
        raise WorkerError("worker state is unavailable")
    receipt_stat = _regular_file(receipt, "bridge result")
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
            for arcname, path, metadata in [("state/bridge-result.json", receipt, receipt_stat), *[
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


def provider_environment(state_root: Path, timeout_s: int) -> dict[str, str]:
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
    home = state_root / "home"
    kimi_home = state_root / "kimi-code"
    temporary = state_root / "tmp"
    for path in (home, kimi_home, temporary):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path, 0o700)
    return {
        "HOME": str(home),
        "TMPDIR": str(temporary),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "KIMI_CODE_HOME": str(kimi_home),
        "KIMI_DISABLE_TELEMETRY": "1",
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


def reap_group(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=2)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    process.wait(timeout=2)


def run(args: argparse.Namespace) -> int:
    envelope = load_json(args.envelope, "envelope")
    role = envelope.get("role")
    if role not in {"planner", "generator", "evaluator"}:
        raise WorkerError("envelope role is invalid")
    deliverable = envelope.get("deliverable")
    if not isinstance(deliverable, dict):
        raise WorkerError("envelope deliverable is invalid")
    safe_relative_path(deliverable.get("artifact"), "envelope artifact")
    target = target_from(args.target, role)
    worktree = args.worktree.resolve()
    state_root = args.worker_state_root.resolve()
    if not worktree.is_dir() or not state_root.is_dir():
        raise WorkerError("guest workspace is unavailable")
    result = args.result.resolve()
    try:
        result.relative_to(state_root)
    except ValueError as exc:
        raise WorkerError("result must stay inside worker state") from exc
    if result.exists() or result.is_symlink():
        raise WorkerError("result already exists")
    bridge = Path(__file__).resolve().parent / "session-bridge.py"
    if not bridge.is_file() or bridge.is_symlink():
        raise WorkerError("staged bridge runner is unavailable")
    worker_env = provider_environment(state_root, args.timeout_s)
    command = [
        sys.executable,
        str(bridge),
        "run",
        "--bridge-id", target["bridge_id"],
        "--strategy", target["bridge_strategy"],
        "--protocol-json", json.dumps(target["bridge_protocol"], separators=(",", ":")),
        "--persona", target["agent_type"],
        "--native-agent-type", target["native_agent_type"],
        "--deliverable-channel", target["deliverable_channel"],
        "--envelope", str(args.envelope.resolve()),
        "--worktree", str(worktree),
        "--result", str(result),
        "--timeout-s", str(args.timeout_s),
        "--worker-state-root", str(state_root),
    ]
    process = subprocess.Popen(
        command,
        cwd=str(worktree),
        env=worker_env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )
    previous: dict[int, Any] = {}

    def cancelled(_signal: int, _frame: Any) -> None:
        reap_group(process)
        raise WorkerError("provider worker was cancelled")

    for item in (signal.SIGTERM, signal.SIGINT):
        previous[item] = signal.signal(item, cancelled)
    try:
        try:
            exit_code = process.wait(timeout=max(1, args.timeout_s))
        except subprocess.TimeoutExpired as exc:
            raise WorkerError("provider worker timed out") from exc
        if exit_code != 0:
            raise WorkerError("provider bridge runner failed")
        if not result.is_file() or result.is_symlink() or result.stat().st_nlink != 1:
            raise WorkerError("provider bridge result is invalid")
        return 0
    finally:
        try:
            reap_group(process)
        finally:
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
    run_parser.add_argument("--result", required=True, type=Path)
    run_parser.add_argument("--timeout-s", required=True, type=int)
    copyout_parser = commands.add_parser("copyout")
    copyout_parser.add_argument("--worktree", required=True, type=Path)
    copyout_parser.add_argument("--worker-state-root", required=True, type=Path)
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
