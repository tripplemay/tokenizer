#!/usr/bin/env python3
"""Validate a provider-attested external Generator bridge receipt.

This is a Coordinator-side consumer of the immutable receipt emitted by the
framework VM provider.  It deliberately does not discover, invoke, or
re-attest a provider: the provider remains the only issuer of the attestation.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pwd
import re
import stat
import sys
from pathlib import Path
from typing import Any, Optional, Union


ATTESTATION_VERSION = "harness/external-bridge-provider-attestation/1"
PROVIDER_ID = "harness-vm-v1"
PROVIDER_KIND = "vm-v1"
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
ACTIVE_ROLE_FIELDS = {
    "agent_id",
    "tool",
    "invocation",
    "model_family",
    "priority",
    "execution_provenance_sha256",
}
BRIDGE_FIELDS = {
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
    "provider_launch_attestation",
}
ATTESTATION_FIELDS = {
    "version",
    "provider_id",
    "provider_kind",
    "contract_sha256",
    "phase",
    "nonce_sha256",
    "issued_at",
    "expires_at",
    "image_sha256",
    "runner_sha256",
    "cli_bundle_sha256",
    "broker_policy_sha256",
    "target_provenance_sha256",
}


class ReceiptValidationError(ValueError):
    """Raised when a returned provider receipt cannot be trusted."""


def fail(message: str) -> None:
    raise ReceiptValidationError(message)


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            fail(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def absolute_path(value: Union[str, Path], label: str) -> Path:
    raw = os.fspath(value)
    if not isinstance(raw, str) or not raw:
        fail(f"{label} path is invalid")
    return Path(os.path.abspath(raw))


def absolute_meta_path(value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value:
        fail(f"run metadata {label} is invalid")
    candidate = Path(value)
    if not candidate.is_absolute():
        fail(f"run metadata {label} must be absolute")
    return absolute_path(candidate, label)


def secure_directory(path: Path, label: str) -> None:
    try:
        entry = path.lstat()
    except OSError as exc:
        fail(f"{label} is unavailable: {exc}")
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
        fail(f"{label} must be a non-symlink directory")


def secure_private_directory(path: Path, label: str) -> None:
    secure_directory(path, label)
    try:
        entry = path.lstat()
    except OSError as exc:
        fail(f"{label} is unavailable: {exc}")
    if entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        fail(f"{label} must not be group/world writable")


def secure_regular_file(path: Path, label: str) -> None:
    try:
        entry = path.lstat()
    except OSError as exc:
        fail(f"{label} is unavailable: {exc}")
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
        fail(f"{label} must be an unlinked regular file")


def secure_directory_under(root: Path, path: Path, label: str) -> None:
    """Validate a directory and every descendant from an already trusted root."""
    root = absolute_path(root, f"{label} root")
    path = absolute_path(path, label)
    secure_directory(root, f"{label} root")
    try:
        relative = path.relative_to(root)
    except ValueError:
        fail(f"{label} escapes its trusted root")
    current = root
    for part in relative.parts:
        current = current / part
        secure_directory(current, label)


def secure_private_directory_under(root: Path, path: Path, label: str) -> None:
    root = absolute_path(root, f"{label} root")
    path = absolute_path(path, label)
    secure_private_directory(root, f"{label} root")
    try:
        relative = path.relative_to(root)
    except ValueError:
        fail(f"{label} escapes its trusted root")
    current = root
    for part in relative.parts:
        current = current / part
        secure_private_directory(current, label)


def load_json(path: Path, label: str) -> dict[str, Any]:
    secure_regular_file(path, label)
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, ValueError) as exc:
        fail(f"cannot read {label}: {exc}")
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def parse_active_role(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except (TypeError, ValueError) as exc:
        fail(f"active Generator role is malformed: {exc}")
    if not isinstance(value, dict) or set(value) != ACTIVE_ROLE_FIELDS:
        fail("external Generator receipt requires a signed active Generator subagent route")
    if (
        not isinstance(value.get("agent_id"), str)
        or SAFE_ID.fullmatch(value["agent_id"]) is None
        or value.get("invocation") != "subagent"
        or not isinstance(value.get("execution_provenance_sha256"), str)
        or SHA256.fullmatch(value["execution_provenance_sha256"]) is None
    ):
        fail("active Generator role is not a signed subagent route")
    return value


def canonical_attestation_sha256(value: dict[str, Any]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(ATTESTATION_VERSION.encode("ascii") + b"\0" + encoded).hexdigest()


def regular_sha256(path: Path, label: str) -> str:
    """Digest one provider-produced file without accepting links or aliases."""
    try:
        initial = path.lstat()
    except OSError as exc:
        fail(f"{label} is unavailable: {exc}")
    if stat.S_ISLNK(initial.st_mode) or not stat.S_ISREG(initial.st_mode) or initial.st_nlink != 1:
        fail(f"{label} must be an unlinked regular file")
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        fail(f"{label} cannot be opened: {exc}")
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or opened.st_size != initial.st_size
        ):
            fail(f"{label} changed while it was being checked")
        digest = hashlib.sha256()
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                digest.update(block)
        return digest.hexdigest()
    except OSError as exc:
        fail(f"{label} cannot be read: {exc}")
    finally:
        os.close(descriptor)


def parse_rfc3339(value: Any, label: str) -> dt.datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(f"provider launch attestation {label} is invalid")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        fail(f"provider launch attestation {label} is invalid")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        fail(f"provider launch attestation {label} is invalid")
    return parsed.astimezone(dt.timezone.utc)


def provider_runs_root() -> Path:
    try:
        home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    except (KeyError, OSError) as exc:
        fail(f"cannot resolve account home for provider transient state: {exc}")
    home = absolute_path(home, "account home")
    secure_directory(home, "account home")
    runs = home
    for part in (".tokenizer", "harness", "vm-v1", "runs"):
        runs = runs / part
        secure_private_directory(runs, "provider transient state")
    return runs


def safe_artifact_relative(value: Any) -> str:
    if not isinstance(value, str) or not value:
        fail("envelope deliverable artifact is invalid")
    candidate = Path(value)
    if candidate.is_absolute() or "\\" in value or any(part in ("", ".", "..") for part in candidate.parts):
        fail("envelope deliverable artifact must be a safe repository-relative path")
    return value


def validate_generator_subagent_receipt(
    *,
    run_meta_path: Path,
    handoff_path: Path,
    envelope_path: Path,
    project_root: Path,
    active_role_raw: str,
    transient_runs_root: Optional[Path] = None,
) -> None:
    """Validate one completed Generator result produced by ``harness-vm-v1``.

    ``transient_runs_root`` exists only as an in-process test seam.  The public
    command always derives the account-owned provider root itself.
    """
    project_root = absolute_path(project_root, "project root")
    secure_directory(project_root, "project root")
    run_meta_path = absolute_path(run_meta_path, "run metadata")
    handoff_path = absolute_path(handoff_path, "provider handoff artifact")
    envelope_path = absolute_path(envelope_path, "envelope")
    active_role = parse_active_role(active_role_raw)

    state_root = run_meta_path.parent
    if state_root == project_root:
        fail("provider run metadata must live under a project state directory")
    secure_directory_under(project_root, state_root, "project state")
    secure_regular_file(run_meta_path, "run metadata")
    envelope = load_json(envelope_path, "envelope")
    meta = load_json(run_meta_path, "run metadata")

    if envelope.get("role") != "generator":
        fail("envelope role must be generator")
    task_id = envelope.get("task_id")
    batch = envelope.get("batch")
    repo = envelope.get("repo")
    deliverable = envelope.get("deliverable")
    if not isinstance(task_id, str) or SAFE_ID.fullmatch(task_id) is None:
        fail("envelope task_id is invalid")
    if not isinstance(batch, str) or SAFE_ID.fullmatch(batch) is None:
        fail("envelope batch is invalid")
    if (
        not isinstance(repo, dict)
        or not isinstance(repo.get("ref"), str)
        or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", repo["ref"]) is None
    ):
        fail("envelope repo.ref must be a canonical immutable commit SHA")
    if not isinstance(deliverable, dict):
        fail("envelope deliverable is invalid")
    artifact_rel = safe_artifact_relative(deliverable.get("artifact"))

    if (
        meta.get("role") != "generator"
        or meta.get("transport") != "subagent"
        or meta.get("outcome") != "RETURNED"
        or meta.get("exit_code") != 0
    ):
        fail("run metadata is not a completed external Generator subagent result")
    if meta.get("agent_id") != active_role["agent_id"]:
        fail("run metadata agent_id does not match the re-verified active Generator role")
    if (
        meta.get("task_id") != task_id
        or meta.get("batch") != batch
        or meta.get("ref") != repo["ref"]
        or meta.get("deliverable") != deliverable
    ):
        fail("run metadata does not match the commissioning envelope")
    if run_meta_path.name != f"run-meta-{task_id}.json":
        fail("provider run metadata path is not task-bound")

    meta_envelope = absolute_meta_path(meta.get("envelope_path"), "envelope_path")
    if meta_envelope != envelope_path:
        fail("run metadata envelope_path does not match the supplied envelope")
    secure_regular_file(meta_envelope, "provider envelope")
    meta_artifact = absolute_meta_path(meta.get("artifact"), "artifact")
    if meta_artifact != handoff_path:
        fail("run metadata artifact does not match the supplied handoff")
    worktree = absolute_meta_path(meta.get("worktree"), "worktree")

    expected_runs_root = (
        absolute_path(transient_runs_root, "provider transient runs root")
        if transient_runs_root is not None
        else provider_runs_root()
    )
    run_root = worktree.parent
    if (
        run_root.parent != expected_runs_root
        or re.fullmatch(re.escape(task_id) + r"-[0-9a-f]{24}", run_root.name) is None
        or worktree != run_root / "copyout"
    ):
        fail("provider staging path is not the account-owned task copy-out tree")
    secure_private_directory_under(expected_runs_root, worktree, "provider copy-out staging")
    artifact_parent = handoff_path.parent
    secure_directory_under(worktree, artifact_parent, "provider handoff artifact parent")
    if handoff_path != worktree / artifact_rel:
        fail("handoff path does not equal the fixed artifact path inside provider staging")
    try:
        handoff_path.relative_to(worktree)
    except ValueError:
        fail("handoff artifact resolves outside the provider copy-out tree")

    bridge = meta.get("bridge")
    if not isinstance(bridge, dict) or set(bridge) != BRIDGE_FIELDS:
        fail("subagent Generator handoff lacks a provider-attested bridge receipt")
    attestation = bridge.get("provider_launch_attestation")
    if not isinstance(attestation, dict) or set(attestation) != ATTESTATION_FIELDS:
        fail("provider launch attestation shape is invalid")
    if (
        attestation.get("version") != ATTESTATION_VERSION
        or attestation.get("provider_id") != PROVIDER_ID
        or attestation.get("provider_kind") != PROVIDER_KIND
        or attestation.get("phase") != "launch"
    ):
        fail("provider launch attestation identity is invalid")
    for key in (
        "contract_sha256",
        "nonce_sha256",
        "image_sha256",
        "runner_sha256",
        "cli_bundle_sha256",
        "broker_policy_sha256",
        "target_provenance_sha256",
    ):
        if not isinstance(attestation.get(key), str) or SHA256.fullmatch(attestation[key]) is None:
            fail(f"provider launch attestation {key} is invalid")
    issued_at = parse_rfc3339(attestation.get("issued_at"), "issued_at")
    expires_at = parse_rfc3339(attestation.get("expires_at"), "expires_at")
    ttl = (expires_at - issued_at).total_seconds()
    if ttl <= 0 or ttl > 300:
        fail("provider launch attestation lifetime is invalid")
    now = dt.datetime.now(dt.timezone.utc)
    if issued_at > now + dt.timedelta(seconds=30):
        fail("provider launch attestation issued_at is too far in the future")
    if expires_at <= now:
        fail("provider launch attestation has expired")
    if attestation["target_provenance_sha256"] != active_role["execution_provenance_sha256"]:
        fail("provider launch attestation is not bound to the re-verified Generator route")

    if (
        not isinstance(bridge.get("bridge_id"), str)
        or SAFE_ID.fullmatch(bridge["bridge_id"]) is None
        or not isinstance(bridge.get("bridge_strategy"), str)
        or SAFE_ID.fullmatch(bridge["bridge_strategy"]) is None
        or bridge.get("bridge_kind") != "acp-native-agent/v1"
        or bridge.get("session_scope") != "same-session"
        or bridge.get("subagent_type") != "coder"
        or bridge.get("terminal_status") != "completed"
    ):
        fail("provider bridge receipt does not describe a completed Generator subagent")
    for key in (
        "session_id_sha256",
        "nonce_sha256",
        "child_call_id_sha256",
        "provider_launch_attestation_sha256",
        "artifact_sha256",
    ):
        if not isinstance(bridge.get(key), str) or SHA256.fullmatch(bridge[key]) is None:
            fail(f"provider bridge receipt {key} is invalid")
    if bridge["nonce_sha256"] != attestation["nonce_sha256"]:
        fail("provider bridge receipt nonce does not match its launch attestation")
    if bridge["provider_launch_attestation_sha256"] != canonical_attestation_sha256(attestation):
        fail("provider bridge receipt launch attestation digest is invalid")
    if bridge["artifact_sha256"] != regular_sha256(handoff_path, "provider handoff artifact"):
        fail("provider bridge receipt artifact digest is invalid")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--role", required=True, choices=("generator",))
    result.add_argument("--run-meta", required=True)
    result.add_argument("--handoff", required=True)
    result.add_argument("--envelope", required=True)
    result.add_argument("--project-root", required=True)
    result.add_argument("--active-role-json", required=True)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        validate_generator_subagent_receipt(
            run_meta_path=Path(args.run_meta),
            handoff_path=Path(args.handoff),
            envelope_path=Path(args.envelope),
            project_root=Path(args.project_root),
            active_role_raw=args.active_role_json,
        )
    except ReceiptValidationError as exc:
        print(f"[external-bridge-receipt] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
