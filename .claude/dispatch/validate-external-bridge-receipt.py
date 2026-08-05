#!/usr/bin/env python3
"""Validate a provider-attested external same-session bridge receipt.

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
MAX_LAUNCH_ATTESTATION_TTL_SECONDS = 390
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
ACTIVE_TARGET_REQUIRED_FIELDS = {
    "target_id",
    "tool",
    "invocation",
    "model_family",
    "priority",
    "roles",
    "agent_type",
    "native_agent_type",
    "bridge_id",
    "bridge_strategy",
    "session_scope",
    "bridge_protocol",
    "bridge_provider_id",
    "bridge_provider_kind",
    "bridge_provider_contract_sha256",
    "execution_provenance_sha256",
}
ACTIVE_TARGET_OPTIONAL_FIELDS = {
    "integration_id",
    "adapter",
    "sandbox",
    "timeout_s",
    "adapter_execution_contract_sha256",
    "capabilities",
}
ACTIVE_TARGET_FIELDS = ACTIVE_TARGET_REQUIRED_FIELDS | ACTIVE_TARGET_OPTIONAL_FIELDS
BRIDGE_PROTOCOL_FIELDS = {"kind", "command", "request_delivery", "response_format"}
ROLE_PERSONAS = {
    "planner": "planner-proposal",
    "generator": "generator-restricted",
    "evaluator": "evaluator",
}
ROLE_DELIVERABLES = {
    "planner": ".claude/dispatch/planner-proposal.schema.json",
    "generator": ".claude/dispatch/generator-handoff.schema.json",
    "evaluator": ".claude/autonomous/verdict-artifact.schema.json",
}
NATIVE_AGENT_TYPES = {"plan", "coder", "explore"}
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
    "envelope_sha256",
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


def role_label(role: str) -> str:
    return role.capitalize()


def parse_active_role(raw: str, role: str) -> dict[str, Any]:
    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except (TypeError, ValueError) as exc:
        fail(f"active {role_label(role)} role is malformed: {exc}")
    if not isinstance(value, dict) or set(value) != ACTIVE_ROLE_FIELDS:
        fail(f"external {role_label(role)} receipt requires a signed active {role_label(role)} subagent route")
    if (
        not isinstance(value.get("agent_id"), str)
        or SAFE_ID.fullmatch(value["agent_id"]) is None
        or not isinstance(value.get("tool"), str)
        or SAFE_ID.fullmatch(value["tool"]) is None
        or value.get("invocation") != "subagent"
        or not isinstance(value.get("model_family"), str)
        or not value["model_family"]
        or isinstance(value.get("priority"), bool)
        or not isinstance(value.get("priority"), int)
        or value["priority"] < 0
        or not isinstance(value.get("execution_provenance_sha256"), str)
        or SHA256.fullmatch(value["execution_provenance_sha256"]) is None
    ):
        fail(f"active {role_label(role)} role is not a signed subagent route")
    return value


def parse_active_target(raw: str, *, role: str, active_role: dict[str, Any]) -> dict[str, Any]:
    """Bind the returned bridge metadata to the already signed role route.

    ``tool-catalog target`` emits this full execution target immediately after
    the active role has been re-verified.  The target's provenance must match
    the signed role before any bridge-owned receipt field is trusted.
    """
    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except (TypeError, ValueError) as exc:
        fail(f"active {role_label(role)} target is malformed: {exc}")
    if not isinstance(value, dict):
        fail(f"active {role_label(role)} target must be an object")
    missing = sorted(ACTIVE_TARGET_REQUIRED_FIELDS - set(value))
    unsupported = sorted(set(value) - ACTIVE_TARGET_FIELDS)
    if missing or unsupported:
        fail(
            f"active {role_label(role)} target shape is invalid"
            + (f" (missing {missing})" if missing else "")
            + (f" (unsupported {unsupported})" if unsupported else "")
        )

    if (
        not isinstance(value.get("target_id"), str)
        or SAFE_ID.fullmatch(value["target_id"]) is None
        or value["target_id"] != active_role["agent_id"]
        or not isinstance(value.get("tool"), str)
        or SAFE_ID.fullmatch(value["tool"]) is None
        or value["tool"] != active_role["tool"]
        or value.get("invocation") != active_role["invocation"]
        or value.get("invocation") != "subagent"
        or not isinstance(value.get("model_family"), str)
        or value["model_family"] != active_role["model_family"]
        or isinstance(value.get("priority"), bool)
        or value.get("priority") != active_role["priority"]
        or not isinstance(value.get("execution_provenance_sha256"), str)
        or value["execution_provenance_sha256"] != active_role["execution_provenance_sha256"]
        or SHA256.fullmatch(value["execution_provenance_sha256"]) is None
    ):
        fail(f"active {role_label(role)} target is not bound to the signed active role")

    roles = value.get("roles")
    if (
        not isinstance(roles, list)
        or role not in roles
        or any(not isinstance(item, str) or item not in ROLE_PERSONAS for item in roles)
        or len(roles) != len(set(roles))
        or value.get("agent_type") != ROLE_PERSONAS[role]
        or value.get("native_agent_type") not in NATIVE_AGENT_TYPES
        or not isinstance(value.get("bridge_id"), str)
        or SAFE_ID.fullmatch(value["bridge_id"]) is None
        or value["bridge_id"] == "host-native"
        or not isinstance(value.get("bridge_strategy"), str)
        or SAFE_ID.fullmatch(value["bridge_strategy"]) is None
        or value.get("session_scope") != "same-session"
        or value.get("bridge_provider_id") != PROVIDER_ID
        or value.get("bridge_provider_kind") != PROVIDER_KIND
        or not isinstance(value.get("bridge_provider_contract_sha256"), str)
        or SHA256.fullmatch(value["bridge_provider_contract_sha256"]) is None
    ):
        fail(f"active {role_label(role)} target is not a supported external bridge route")

    protocol = value.get("bridge_protocol")
    if (
        not isinstance(protocol, dict)
        or set(protocol) != BRIDGE_PROTOCOL_FIELDS
        or protocol.get("kind") != "acp-native-agent/v1"
        or protocol.get("request_delivery") != "stdin"
        or protocol.get("response_format") != "json"
        or not isinstance(protocol.get("command"), list)
        or not protocol["command"]
        or any(not isinstance(item, str) or not item for item in protocol["command"])
    ):
        fail(f"active {role_label(role)} target bridge protocol is invalid")
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


def expected_deliverable(role: str, *, task_id: str, batch: str) -> tuple[str, str]:
    if role == "planner":
        artifact = f"docs/test-reports/planner-proposal-{task_id}.json"
    elif role == "generator":
        artifact = f"docs/test-reports/generator-handoff-{task_id}.json"
    elif role == "evaluator":
        artifact = f"docs/test-reports/{batch}-verdict.json"
    else:
        fail(f"unsupported external bridge role {role!r}")
    return artifact, ROLE_DELIVERABLES[role]


def validate_external_subagent_receipt(
    *,
    role: str,
    run_meta_path: Path,
    artifact_path: Path,
    envelope_path: Path,
    project_root: Path,
    active_role_raw: str,
    active_target_raw: str,
    transient_runs_root: Optional[Path] = None,
) -> None:
    """Validate one provider-attested external result for a signed role route.

    ``transient_runs_root`` exists only as an in-process test seam.  The public
    command always derives the account-owned provider root itself.
    """
    if role not in ROLE_PERSONAS:
        fail(f"unsupported external bridge role {role!r}")
    project_root = absolute_path(project_root, "project root")
    secure_directory(project_root, "project root")
    run_meta_path = absolute_path(run_meta_path, "run metadata")
    artifact_path = absolute_path(artifact_path, "provider artifact")
    envelope_path = absolute_path(envelope_path, "envelope")
    active_role = parse_active_role(active_role_raw, role)
    active_target = parse_active_target(active_target_raw, role=role, active_role=active_role)

    state_root = run_meta_path.parent
    if state_root == project_root:
        fail("provider run metadata must live under a project state directory")
    secure_directory_under(project_root, state_root, "project state")
    secure_regular_file(run_meta_path, "run metadata")
    envelope = load_json(envelope_path, "envelope")
    meta = load_json(run_meta_path, "run metadata")

    if envelope.get("role") != role:
        fail(f"envelope role must be {role}")
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
    expected_artifact, expected_schema = expected_deliverable(role, task_id=task_id, batch=batch)
    if artifact_rel != expected_artifact or deliverable.get("schema") != expected_schema:
        fail(f"envelope deliverable is not the fixed {role_label(role)} artifact contract")
    if deliverable.get("commit_to", object()) is not None:
        fail(f"envelope {role_label(role)} deliverable.commit_to must be null")
    envelope_sha256 = regular_sha256(envelope_path, "envelope")

    if (
        meta.get("role") != role
        or meta.get("transport") != "subagent"
        or meta.get("outcome") != "RETURNED"
        or meta.get("exit_code") != 0
    ):
        fail(f"run metadata is not a completed external {role_label(role)} subagent result")
    if meta.get("agent_id") != active_role["agent_id"]:
        fail(f"run metadata agent_id does not match the re-verified active {role_label(role)} role")
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
    if meta_artifact != artifact_path:
        fail("run metadata artifact does not match the supplied artifact")
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
    artifact_parent = artifact_path.parent
    secure_directory_under(worktree, artifact_parent, "provider artifact parent")
    if artifact_path != worktree / artifact_rel:
        fail("artifact path does not equal the fixed artifact path inside provider staging")
    try:
        artifact_path.relative_to(worktree)
    except ValueError:
        fail("artifact resolves outside the provider copy-out tree")

    bridge = meta.get("bridge")
    if not isinstance(bridge, dict) or set(bridge) != BRIDGE_FIELDS:
        fail(f"subagent {role_label(role)} artifact lacks a provider-attested bridge receipt")
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
        "envelope_sha256",
    ):
        if not isinstance(attestation.get(key), str) or SHA256.fullmatch(attestation[key]) is None:
            fail(f"provider launch attestation {key} is invalid")
    issued_at = parse_rfc3339(attestation.get("issued_at"), "issued_at")
    expires_at = parse_rfc3339(attestation.get("expires_at"), "expires_at")
    ttl = (expires_at - issued_at).total_seconds()
    if ttl <= 0 or ttl > MAX_LAUNCH_ATTESTATION_TTL_SECONDS:
        fail("provider launch attestation lifetime is invalid")
    now = dt.datetime.now(dt.timezone.utc)
    if issued_at > now + dt.timedelta(seconds=30):
        fail("provider launch attestation issued_at is too far in the future")
    if expires_at <= now:
        fail("provider launch attestation has expired")
    if attestation["target_provenance_sha256"] != active_role["execution_provenance_sha256"]:
        fail(f"provider launch attestation is not bound to the re-verified {role_label(role)} route")
    if attestation["envelope_sha256"] != envelope_sha256:
        fail("provider launch attestation is not bound to the supplied envelope bytes")
    if (
        active_target["bridge_provider_id"] != attestation["provider_id"]
        or active_target["bridge_provider_kind"] != attestation["provider_kind"]
        or active_target["bridge_provider_contract_sha256"] != attestation["contract_sha256"]
        or active_target["execution_provenance_sha256"] != attestation["target_provenance_sha256"]
    ):
        fail("provider launch attestation is not bound to the signed active target")

    protocol = active_target["bridge_protocol"]
    if (
        bridge.get("bridge_id") != active_target["bridge_id"]
        or bridge.get("bridge_strategy") != active_target["bridge_strategy"]
        or bridge.get("bridge_kind") != protocol["kind"]
        or bridge.get("session_scope") != active_target["session_scope"]
        or bridge.get("subagent_type") != active_target["native_agent_type"]
        or bridge.get("terminal_status") != "completed"
    ):
        fail(f"provider bridge receipt does not match the signed active {role_label(role)} target")
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
    if bridge["artifact_sha256"] != regular_sha256(artifact_path, "provider artifact"):
        fail("provider bridge receipt artifact digest is invalid")


def validate_generator_subagent_receipt(
    *,
    run_meta_path: Path,
    handoff_path: Path,
    envelope_path: Path,
    project_root: Path,
    active_role_raw: str,
    active_target_raw: str,
    transient_runs_root: Optional[Path] = None,
) -> None:
    """Compatibility entrypoint for callers that use the Generator term."""
    validate_external_subagent_receipt(
        role="generator",
        run_meta_path=run_meta_path,
        artifact_path=handoff_path,
        envelope_path=envelope_path,
        project_root=project_root,
        active_role_raw=active_role_raw,
        active_target_raw=active_target_raw,
        transient_runs_root=transient_runs_root,
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--role", required=True, choices=tuple(ROLE_PERSONAS))
    result.add_argument("--run-meta", required=True)
    result.add_argument("--artifact", "--handoff", dest="artifact", required=True)
    result.add_argument("--envelope", required=True)
    result.add_argument("--project-root", required=True)
    result.add_argument("--active-role-json", required=True)
    result.add_argument("--active-target-json", required=True)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        validate_external_subagent_receipt(
            role=args.role,
            run_meta_path=Path(args.run_meta),
            artifact_path=Path(args.artifact),
            envelope_path=Path(args.envelope),
            project_root=Path(args.project_root),
            active_role_raw=args.active_role_json,
            active_target_raw=args.active_target_json,
        )
    except ReceiptValidationError as exc:
        print(f"[external-bridge-receipt] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
