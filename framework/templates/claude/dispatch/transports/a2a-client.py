#!/usr/bin/env python3
"""Bounded A2A-shaped client for harness dispatch (stdlib-only JSON-RPC + SSE)."""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


DISPATCH_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ADAPTERS_DIR = os.path.join(DISPATCH_DIR, "transports", "adapters")
sys.path.insert(0, DISPATCH_DIR)
from dispatch_common import (  # noqa: E402
    A2A_AUTH_UNSET,
    DispatchContractError,
    a2a_auth_config,
    effective_timeout,
    project_registry_path,
)


STATE_DIR_DEFAULT = ".harness-dispatch"
TRANSPORT_GRACE_S = 5.0
TERMINAL = {
    "COMPLETED", "FAILED", "CANCELED", "REJECTED",
    "INPUT_REQUIRED", "AUTH_REQUIRED",
}
TOOL_INTEGRATIONS_VERSION = "tool-integrations/1"
A2A_TARGET_PREFIX = "a2a--"
A2A_ROLES = ("planner", "evaluator")
ACTIVE_MODE_RECORD_FIELDS = {
    "agent_id",
    "tool",
    "invocation",
    "model_family",
    "priority",
    "execution_provenance_sha256",
}
SAFE_TASK_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}\Z")
SAFE_BATCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SAFE_ARTIFACT = re.compile(
    r"[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*\Z"
)
CANONICAL_COMMIT_SHA = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
SAFE_CONFIG_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SAFE_TOOL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
SAFE_CAPABILITY = re.compile(r"[A-Za-z0-9._-]{1,64}\Z")
EXECUTION_PROVENANCE_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_MISSING = object()
_LOCAL_TERMINAL_MARKER = object()


class ClientError(RuntimeError):
    pass


def log(message):
    sys.stderr.write(f"[a2a-client] {message}\n")


def die(message, code=2):
    log(f"error: {message}")
    raise SystemExit(code)


def _load_registry(registry):
    try:
        with open(registry, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        raise ClientError(f"registry unreadable ({registry}): {exc}")


def _safe_config_id(value, label):
    if not isinstance(value, str) or not SAFE_CONFIG_ID.fullmatch(value):
        raise ClientError(f"{label} must be a safe stable id")
    return value


def _safe_tool_id(value, label):
    if not isinstance(value, str) or not SAFE_TOOL_ID.fullmatch(value):
        raise ClientError(f"{label} must be a safe stable tool id")
    return value


def _nonempty_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ClientError(f"{label} must be a non-empty string")
    return value


def _bounded_text(value, label, maximum):
    normalized = _nonempty_string(value, label).strip()
    if len(normalized) > maximum or CONTROL_CHARACTERS.search(value):
        raise ClientError(
            f"{label} must be a non-empty string of at most {maximum} characters "
            "without control characters"
        )
    return normalized


def _capabilities(value, label):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 64:
        raise ClientError(f"{label} must be a string array")
    parsed = []
    for index, item in enumerate(value):
        capability = _bounded_text(item, f"{label}[{index}]", 64)
        if not SAFE_CAPABILITY.fullmatch(capability):
            raise ClientError(
                f"{label}[{index}] must match {SAFE_CAPABILITY.pattern!r}"
            )
        parsed.append(capability)
    return sorted(set(parsed))


def _lookup_id(items, item_id, label):
    if not isinstance(items, list):
        raise ClientError(f"{label} must be an array")
    matches = []
    for item in items:
        if not isinstance(item, dict):
            raise ClientError(f"{label} entries must be objects")
        candidate_id = _safe_tool_id(item.get("id"), f"{label}.id")
        if candidate_id == item_id:
            matches.append(item)
    if len(matches) != 1:
        if not matches:
            raise ClientError(f"{label} id not found: {item_id}")
        raise ClientError(f"{label} id is duplicated: {item_id}")
    return matches[0]


def _target_selector(requested):
    """Return (target id, fixed role) for a generated or compatibility id."""
    value = requested[len(A2A_TARGET_PREFIX):] if requested.startswith(A2A_TARGET_PREFIX) else requested
    if not isinstance(value, str):
        raise ClientError("A2A target id must be a safe stable tool id")
    for role in A2A_ROLES:
        suffix = f"--{role}"
        if value.endswith(suffix):
            target_id = value[:-len(suffix)]
            return _safe_tool_id(target_id, "A2A target id"), role
    if value.endswith("--generator"):
        raise ClientError(
            "a2a transport does not support generator until a source-handoff "
            "protocol can return implementation changes safely"
        )
    return _safe_tool_id(value, "A2A target id"), None


def _preflight_canonical_target(registry_path, adapters_dir, target_id, fixed_role):
    """Reuse the catalog before this client can contact a configured endpoint.

    Canonical A2A targets are backed by a local CLI integration.  The catalog
    owns its adapter verification, tool/family matching, and role policy, so a
    direct client must not reimplement a weaker subset and potentially forward
    a bearer token before discovering a bad adapter.
    """
    catalog = os.path.join(DISPATCH_DIR, "tool-catalog.py")
    if not os.path.isfile(catalog):
        raise ClientError(f"framework tool catalog missing: {catalog}")
    roles = (fixed_role,) if fixed_role else A2A_ROLES
    for role in roles:
        generated_target = f"{A2A_TARGET_PREFIX}{target_id}--{role}"
        command = [
            sys.executable,
            catalog,
            "target",
            "--registry",
            os.fspath(registry_path),
            "--adapters",
            os.fspath(adapters_dir),
            "--target-id",
            generated_target,
        ]
        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ClientError(
                f"A2A target {generated_target!r} catalog preflight could not run: {exc}"
            ) from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "tool catalog failed").strip()
            raise ClientError(
                f"A2A target {generated_target!r} catalog preflight failed: {detail[:600]}"
            )
        try:
            target = json.loads(result.stdout)
        except (TypeError, ValueError) as exc:
            raise ClientError(
                f"A2A target {generated_target!r} catalog preflight returned invalid JSON: {exc}"
            ) from exc
        if (
            not isinstance(target, dict)
            or target.get("target_id") != generated_target
            or target.get("invocation") != "a2a"
            or role not in (target.get("roles") or [])
        ):
            raise ClientError(
                f"A2A target {generated_target!r} catalog preflight returned an incompatible target"
            )


def _integration_target_descriptor(data, requested, *, registry_path, adapters_dir):
    """Normalize one non-user-facing A2A target into the legacy descriptor shape."""
    if data.get("version") != TOOL_INTEGRATIONS_VERSION:
        raise ClientError(
            f"tool integration registry version must be {TOOL_INTEGRATIONS_VERSION!r}"
        )
    target_id, fixed_role = _target_selector(requested)
    _preflight_canonical_target(registry_path, adapters_dir, target_id, fixed_role)
    target = _lookup_id(data.get("a2a_targets"), target_id, "a2a_targets")
    integration_id = _safe_tool_id(
        target.get("integration_id"), f"a2a target {target_id!r}.integration_id"
    )
    integration = _lookup_id(
        data.get("integrations"), integration_id, "integrations"
    )
    local_cli = integration.get("local_cli")
    if not isinstance(local_cli, dict):
        raise ClientError(
            f"integration {integration_id!r}.local_cli must be an object for A2A"
        )
    _safe_tool_id(
        local_cli.get("adapter"), f"integration {integration_id!r}.local_cli.adapter"
    )
    if not isinstance(local_cli.get("sandbox"), dict):
        raise ClientError(
            f"integration {integration_id!r}.local_cli.sandbox must be an object"
        )
    timeout_s = local_cli.get("timeout_s")
    try:
        effective_timeout(None, timeout_s)
    except DispatchContractError as exc:
        raise ClientError(
            f"integration {integration_id!r}.local_cli.timeout_s: {exc}"
        ) from exc

    endpoint = _bounded_text(target.get("endpoint"), f"a2a target {target_id!r}.endpoint", 2048)
    remote_runner_id = _safe_config_id(
        target.get("remote_runner_id"),
        f"a2a target {target_id!r}.remote_runner_id",
    )
    tool = _safe_tool_id(
        integration.get("tool"), f"integration {integration_id!r}.tool"
    )
    model_family = _bounded_text(
        integration.get("model_family"), f"integration {integration_id!r}.model_family", 128
    )
    try:
        a2a_auth_config(
            target.get("auth", A2A_AUTH_UNSET), f"a2a target {target_id!r}.auth"
        )
    except DispatchContractError as exc:
        raise ClientError(str(exc)) from exc

    integration_capabilities = _capabilities(
        integration.get("capabilities", []), f"integration {integration_id!r}.capabilities"
    )
    target_capabilities = _capabilities(
        target.get("capabilities", []), f"a2a target {target_id!r}.capabilities"
    )
    capabilities = sorted(set(integration_capabilities) | set(target_capabilities))
    descriptor_id = (
        f"{A2A_TARGET_PREFIX}{target_id}--{fixed_role}"
        if fixed_role else f"{A2A_TARGET_PREFIX}{target_id}"
    )
    return {
        "id": descriptor_id,
        "target_id": target_id,
        "integration_id": integration_id,
        "remote_runner_id": remote_runner_id,
        "tool": tool,
        "model_family": model_family,
        "roles": [fixed_role] if fixed_role else list(A2A_ROLES),
        "capabilities": capabilities,
        "transport": "a2a",
        "endpoint": endpoint,
        "auth": target.get("auth", A2A_AUTH_UNSET),
        "timeout_s": timeout_s,
        # New targets are bound to an identity-bearing Agent Card before work
        # is sent. Legacy descriptors retain their historic no-card behavior.
        "remote_card_required": True,
    }


def _legacy_descriptor(data, agent):
    descriptor = next(
        (item for item in data.get("agents", []) if item.get("id") == agent), None
    )
    if descriptor is None:
        raise ClientError(f"agent not found: {agent}")
    if descriptor.get("transport") != "a2a":
        raise ClientError(
            f"{agent} uses transport={descriptor.get('transport')}; a2a is required"
        )
    descriptor = dict(descriptor)
    descriptor["endpoint"] = _bounded_text(
        descriptor.get("endpoint"), f"agent {agent!r}.endpoint", 2048
    )
    if "model_family" in descriptor:
        descriptor["model_family"] = _bounded_text(
            descriptor.get("model_family"), f"agent {agent!r}.model_family", 128
        )
    if "capabilities" in descriptor:
        descriptor["capabilities"] = _capabilities(
            descriptor.get("capabilities"), f"agent {agent!r}.capabilities"
        )
    try:
        effective_timeout(None, descriptor.get("timeout_s"))
        a2a_auth_config(
            descriptor.get("auth", A2A_AUTH_UNSET), f"agent {agent!r}.auth"
        )
    except DispatchContractError as exc:
        raise ClientError(str(exc))
    return descriptor


def load_descriptor(registry, agent, *, adapters=DEFAULT_ADAPTERS_DIR):
    data = _load_registry(registry)
    if not isinstance(data, dict):
        raise ClientError("registry root must be an object")
    if data.get("version") == TOOL_INTEGRATIONS_VERSION:
        return _integration_target_descriptor(
            data, agent, registry_path=registry, adapters_dir=adapters
        )
    return _legacy_descriptor(data, agent)


def verify_expected_execution_provenance(
    registry, agent, adapters, expected, *, expected_role=None
):
    """Re-resolve a target before endpoint/auth data can be consumed.

    ``dispatch-run`` carries the active checkpoint's semantic digest here.
    The catalog is deliberately the sole interpreter of registry, adapter and
    bridge semantics, so this direct A2A entrypoint invokes it rather than
    maintaining a weaker parallel parser.
    """
    if not isinstance(expected, str) or not EXECUTION_PROVENANCE_SHA256.fullmatch(expected):
        raise ClientError("--expected-provenance must be a lowercase SHA-256")
    catalog = os.path.join(DISPATCH_DIR, "tool-catalog.py")
    if not os.path.isfile(catalog):
        raise ClientError(f"framework tool catalog missing: {catalog}")
    command = [
        sys.executable,
        catalog,
        "target",
        "--registry",
        os.fspath(registry),
        "--adapters",
        os.fspath(adapters),
        "--target-id",
        agent,
    ]
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ClientError(f"execution provenance catalog preflight could not run: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "tool catalog failed").strip()
        raise ClientError(f"execution provenance catalog preflight failed: {detail[:600]}")
    try:
        target = json.loads(result.stdout)
    except (TypeError, ValueError) as exc:
        raise ClientError(f"execution provenance catalog returned invalid JSON: {exc}") from exc
    if not isinstance(target, dict):
        raise ClientError("execution provenance catalog returned a non-object target")
    actual = target.get("execution_provenance_sha256")
    if target.get("target_id") != agent or target.get("invocation") != "a2a":
        raise ClientError("execution provenance catalog returned an incompatible A2A target")
    if expected_role is not None:
        roles = target.get("roles")
        if expected_role not in A2A_ROLES or not isinstance(roles, list) or expected_role not in roles:
            raise ClientError(
                "execution provenance catalog target does not declare the requested role"
            )
    if not isinstance(actual, str) or not EXECUTION_PROVENANCE_SHA256.fullmatch(actual):
        raise ClientError("execution provenance catalog omitted a valid SHA-256")
    if actual != expected:
        raise ClientError(
            "execution target semantics drifted; re-plan and consume before dispatch"
        )
    # The returned object is the one and only registry/adapter interpretation
    # permitted to choose an A2A endpoint or bearer-token configuration below.
    # Do not replace this with load_descriptor(): that would reopen mutable
    # registry state after the provenance decision.
    return target


def descriptor_from_canonical_target(target):
    """Build an A2A descriptor from one catalog target snapshot only.

    This is deliberately separate from ``load_descriptor``.  The latter is a
    compatibility entrypoint which reads the registry itself; invoking it after
    an expected-provenance verification recreates the catalog-to-registry TOCTOU
    that the verified target is meant to close.
    """
    if not isinstance(target, dict):
        raise ClientError("execution provenance catalog returned a non-object target")
    target_id = _safe_config_id(target.get("target_id"), "A2A catalog target id")
    if target.get("invocation") != "a2a":
        raise ClientError("A2A catalog target invocation must be 'a2a'")

    roles = target.get("roles")
    if not isinstance(roles, list) or not roles:
        raise ClientError("A2A catalog target roles must be a non-empty array")
    normalized_roles = []
    for index, role in enumerate(roles):
        if role not in A2A_ROLES:
            raise ClientError(f"A2A catalog target roles[{index}] is unsupported: {role!r}")
        if role not in normalized_roles:
            normalized_roles.append(role)

    integration_id = _safe_config_id(
        target.get("integration_id"), f"A2A catalog target {target_id!r}.integration_id"
    )
    descriptor = {
        "id": target_id,
        "target_id": target_id,
        "integration_id": integration_id,
        "tool": _safe_tool_id(
            target.get("tool"), f"A2A catalog target {target_id!r}.tool"
        ),
        "model_family": _bounded_text(
            target.get("model_family"),
            f"A2A catalog target {target_id!r}.model_family",
            128,
        ),
        "roles": normalized_roles,
        "capabilities": _capabilities(
            target.get("capabilities", []),
            f"A2A catalog target {target_id!r}.capabilities",
        ),
        "transport": "a2a",
        "endpoint": _bounded_text(
            target.get("endpoint"), f"A2A catalog target {target_id!r}.endpoint", 2048
        ),
    }
    try:
        descriptor["auth"] = a2a_auth_config(
            target.get("auth", A2A_AUTH_UNSET), f"A2A catalog target {target_id!r}.auth"
        )
        descriptor["timeout_s"] = effective_timeout(None, target.get("timeout_s"))
    except DispatchContractError as exc:
        raise ClientError(str(exc)) from exc

    # Only integration-backed A2A targets carry a runner identity.  Legacy
    # descriptors intentionally retain their historical no-Agent-Card route.
    if "remote_runner_id" in target:
        descriptor["remote_runner_id"] = _safe_config_id(
            target.get("remote_runner_id"),
            f"A2A catalog target {target_id!r}.remote_runner_id",
        )
        descriptor["remote_card_required"] = True
    return descriptor


def auth_header(descriptor):
    try:
        auth = a2a_auth_config(
            descriptor.get("auth", A2A_AUTH_UNSET),
            f"agent {descriptor.get('id')!r}.auth",
        )
    except DispatchContractError as exc:
        raise ClientError(str(exc)) from exc
    if auth["type"] == "none":
        return {}
    env_name = auth["env"]
    token = os.environ.get(env_name, "").strip()
    if not token:
        raise ClientError(f"environment variable {env_name} is empty")
    return {"Authorization": f"Bearer {token}"}


def rpc(descriptor, method, params, timeout=30.0):
    url = descriptor["endpoint"].rstrip("/") + "/"
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        ensure_ascii=False,
    ).encode()
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", **auth_header(descriptor)},
    )
    try:
        with urllib.request.urlopen(request, timeout=max(0.05, timeout)) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode(errors="replace")
        raise ClientError(f"{method} HTTP {exc.code}: {detail}")
    except Exception as exc:
        raise ClientError(f"{method} connection failed: {exc}")
    if "error" in result:
        raise ClientError(f"{method} returned error: {result['error']}")
    return result.get("result")


def fetch_agent_card(descriptor, timeout=15.0):
    """Load the remote card through the same constrained auth boundary as RPC."""
    url = descriptor["endpoint"].rstrip("/") + "/.well-known/a2a-agent-card"
    request = urllib.request.Request(url, headers=auth_header(descriptor))
    try:
        with urllib.request.urlopen(request, timeout=max(0.05, timeout)) as response:
            card = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode(errors="replace")
        raise ClientError(f"AgentCard HTTP {exc.code}: {detail}")
    except Exception as exc:
        raise ClientError(f"AgentCard connection failed: {exc}")
    if not isinstance(card, dict):
        raise ClientError("AgentCard response must be an object")
    return card


def validate_remote_card(descriptor, role, *, timeout=15.0):
    """Bind an integration target to the runner that will execute the work.

    Legacy agent descriptors predate targets and intentionally preserve their
    original behavior. A tool-integrations target is not allowed to rely only
    on a configured URL: its card must prove the declared tool/family/role.
    """
    if not descriptor.get("remote_card_required"):
        return
    if role not in A2A_ROLES:
        raise ClientError(
            "a2a transport does not support generator until a source-handoff "
            "protocol can return implementation changes safely"
        )
    card = fetch_agent_card(descriptor, timeout=timeout)
    if card.get("name") != descriptor.get("remote_runner_id"):
        raise ClientError("AgentCard name does not match target remote_runner_id")
    provider = card.get("provider")
    if not isinstance(provider, dict) or provider.get("modelFamily") != descriptor.get("model_family"):
        raise ClientError("AgentCard model family does not match target integration")
    roles = card.get("roles")
    if not isinstance(roles, list) or role not in roles:
        raise ClientError(f"AgentCard does not declare role={role!r}")
    harness = card.get("x-harness")
    if not isinstance(harness, dict):
        raise ClientError("AgentCard is missing x-harness metadata")
    if harness.get("contract_version") != "harness/1.1":
        raise ClientError("AgentCard harness contract version is incompatible")
    if harness.get("sandboxed") is not True:
        raise ClientError("AgentCard does not attest sandboxed execution")
    if harness.get("tool") != descriptor.get("tool"):
        raise ClientError("AgentCard tool does not match target integration")
    if harness.get("integration_id") != descriptor.get("integration_id"):
        raise ClientError("AgentCard integration id does not match target")


def _safe_artifact_destination(project_root, relative):
    """Resolve a locally commissioned repository-relative artifact path."""
    if not isinstance(relative, str) or not SAFE_ARTIFACT.fullmatch(relative):
        raise ClientError(
            "commissioned deliverable.artifact is not a safe repository-relative path"
        )
    root = os.path.realpath(project_root)
    if not os.path.isdir(root):
        raise ClientError(f"artifact project root is not a directory: {project_root}")
    destination = os.path.realpath(os.path.join(root, relative))
    try:
        inside_root = os.path.commonpath((root, destination)) == root
    except ValueError:
        inside_root = False
    if not inside_root:
        raise ClientError("commissioned artifact resolves outside the local project root")
    return destination


def _canonical_project_root(project_root=None):
    candidate = project_root or os.getcwd()
    try:
        root = subprocess.check_output(
            ["git", "-C", candidate, "rev-parse", "--show-toplevel"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ClientError(
            "A2A artifact commissioning requires a local git project root"
        ) from exc
    return os.path.realpath(root)


def _validate_role_artifact(role, task_id, batch, artifact):
    if role == "planner":
        expected = f"docs/test-reports/planner-proposal-{task_id}.json"
        if artifact != expected:
            raise ClientError(f"planner artifact must be exactly {expected}")
    elif role == "generator":
        expected = f"docs/test-reports/generator-handoff-{task_id}.json"
        if artifact != expected:
            raise ClientError(f"generator artifact must be exactly {expected}")
    elif role == "evaluator":
        expected = f"docs/test-reports/{batch}-verdict.json"
        if artifact != expected:
            raise ClientError(f"evaluator artifact must be exactly {expected}")


def commission_from_envelope(envelope, envelope_path, *, project_root=None):
    """Freeze the local contract before any remote response is considered."""
    if not isinstance(envelope, dict):
        raise ClientError("envelope root must be an object")
    if envelope.get("contract_version") != "harness/1.1":
        raise ClientError("envelope contract_version must be harness/1.1")
    task_id = envelope.get("task_id")
    batch = envelope.get("batch")
    role = envelope.get("role")
    if not isinstance(task_id, str) or not SAFE_TASK_ID.fullmatch(task_id):
        raise ClientError("envelope task_id is not a safe dispatch identifier")
    if not isinstance(batch, str) or not SAFE_BATCH.fullmatch(batch):
        raise ClientError("envelope batch is not a safe dispatch identifier")
    if role not in ("planner", "generator", "evaluator"):
        raise ClientError(f"envelope role is invalid: {role!r}")

    deliverable = envelope.get("deliverable")
    if not isinstance(deliverable, dict):
        raise ClientError("envelope deliverable must be an object")
    if set(deliverable) - {"artifact", "schema", "commit_to"}:
        raise ClientError("envelope deliverable contains unsupported fields")
    artifact = deliverable.get("artifact")
    schema = deliverable.get("schema")
    if not isinstance(artifact, str) or not SAFE_ARTIFACT.fullmatch(artifact):
        raise ClientError("envelope deliverable.artifact is not a safe repository-relative path")
    _validate_role_artifact(role, task_id, batch, artifact)
    if not isinstance(schema, str) or not schema:
        raise ClientError("envelope deliverable.schema is required")

    repo = envelope.get("repo")
    if not isinstance(repo, dict) or not isinstance(repo.get("ref"), str):
        raise ClientError("envelope repo.ref is required")
    if not CANONICAL_COMMIT_SHA.fullmatch(repo["ref"]):
        raise ClientError("envelope repo.ref must be a canonical immutable commit SHA")
    # JSON round-trip prevents later caller mutation of the envelope object from
    # changing the local authority to which a remote response is bound.
    frozen_deliverable = json.loads(json.dumps(deliverable, ensure_ascii=False))
    root = _canonical_project_root(project_root)
    return {
        "task_id": task_id,
        "batch": batch,
        "role": role,
        "deliverable": frozen_deliverable,
        "ref": repo["ref"],
        "envelope_path": os.path.abspath(envelope_path),
        "artifact_path": _safe_artifact_destination(root, artifact),
    }


def _require_remote_task_id(record, expected_task_id, source):
    if not isinstance(record, dict):
        raise ClientError(f"{source} response must be an object")
    if record.get("taskId", _MISSING) != expected_task_id:
        raise ClientError(
            f"{source} taskId does not match locally commissioned task_id"
        )


def validate_terminal_binding(record, commission, *, locally_synthesized=False):
    """Reject a remote terminal response that is not for this exact envelope."""
    if not isinstance(record, dict):
        raise ClientError("A2A terminal record must be an object")
    if record.get("state") not in TERMINAL:
        raise ClientError("A2A record is not terminal")
    expected = {
        "taskId": commission["task_id"],
        "batch": commission["batch"],
        "role": commission["role"],
        "deliverable": commission["deliverable"],
    }
    for field, expected_value in expected.items():
        if record.get(field, _MISSING) != expected_value:
            origin = "local fallback" if locally_synthesized else "A2A terminal record"
            raise ClientError(
                f"{origin} {field} does not match the locally commissioned envelope"
            )


def _staged_artifact_destination(state_dir, commission):
    """Keep remote bytes inside local dispatch state, never project paths."""
    state_root = os.path.realpath(state_dir)
    stage_root = os.path.realpath(os.path.join(state_root, "a2a-artifacts"))
    filename = os.path.basename(commission["deliverable"]["artifact"])
    destination = os.path.realpath(
        os.path.join(stage_root, commission["task_id"], filename)
    )
    try:
        inside_stage = os.path.commonpath((stage_root, destination)) == stage_root
    except ValueError:
        inside_stage = False
    if not inside_stage:
        raise ClientError("A2A artifact staging path escapes dispatch state")
    return destination


def write_artifact_local(artifact, local_path):
    if artifact is None:
        return None
    # The remote owns only JSON content, not a project path. O_EXCL makes a
    # duplicate/replayed remote response fail rather than overwrite evidence.
    os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(local_path, flags, 0o600)
    except FileExistsError as exc:
        raise ClientError(
            f"refusing to overwrite an existing staged A2A artifact: {local_path}"
        ) from exc
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(artifact, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
    except Exception:
        try:
            os.unlink(local_path)
        except OSError:
            pass
        raise
    log(f"artifact staged locally: {local_path}")
    return local_path


def synth_run_meta(
    descriptor,
    record,
    state_dir,
    *,
    commission,
    effective_timeout_s=None,
    locally_synthesized=False,
):
    """Write the local authoritative receipt input; remote state remains advisory."""
    validate_terminal_binding(
        record, commission, locally_synthesized=locally_synthesized
    )
    # Only artifact content crosses A2A. It is staged under dispatch state;
    # the logical deliverable path remains contract metadata for a later,
    # explicit Coordinator materialization step.
    local_artifact = write_artifact_local(
        record.get("artifact"), _staged_artifact_destination(state_dir, commission)
    )
    state = record.get("state")
    reason = record.get("termination_reason")
    # Remote bytes are diagnostic evidence, not evidence of a successful task.
    # A FAILED/REJECTED terminal record must never turn into RETURNED merely
    # because it carried an artifact-shaped object.
    if state == "COMPLETED" and local_artifact:
        outcome = "RETURNED"
    elif state == "CANCELED" and reason in ("deadline", "client_deadline"):
        outcome = "TIMEOUT"
    elif state == "CANCELED":
        outcome = "CANCELED"
    else:
        outcome = "FAILED"

    meta = {
        "task_id": commission["task_id"],
        "agent_id": descriptor["id"],
        "adapter": "a2a",
        "model_family": descriptor.get("model_family"),
        "batch": commission["batch"],
        "role": commission["role"],
        "deliverable": commission["deliverable"],
        "ref": commission["ref"],
        "worktree": None,
        "artifact": local_artifact or "",
        "log": "",
        "envelope_path": commission["envelope_path"],
        "outcome": outcome,
        "exit_code": record.get("exit_code") if record.get("exit_code") is not None else 0,
        "duration_s": record.get("duration_s") or 0,
        "effective_timeout_s": effective_timeout_s,
        "termination_reason": reason or "remote_terminal",
        "transport": "a2a",
        "endpoint": descriptor["endpoint"],
        "remote_state_advisory": state,
    }
    os.makedirs(state_dir, exist_ok=True)
    path = os.path.join(state_dir, f"run-meta-{commission['task_id']}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    log(f"run-meta written: {path}; validate the local receipt next")
    print(json.dumps(meta, ensure_ascii=False))
    return meta


def _event_record(base, event_name, payload):
    if not isinstance(payload, dict):
        raise ClientError("A2A stream event payload must be an object")
    if event_name == "status":
        base["state"] = payload.get("state")
    elif event_name == "artifact":
        base["artifact"] = payload.get("artifact")


def _stream_once(descriptor, task_id, last_seq, deadline, advisory):
    remaining = deadline - time.time()
    if remaining <= 0:
        return False, last_seq
    url = descriptor["endpoint"].rstrip("/") + "/"
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": "SubscribeToTask",
         "params": {"taskId": task_id}}
    ).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        **auth_header(descriptor),
    }
    if last_seq:
        headers["Last-Event-ID"] = str(last_seq)
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    timeout = max(0.05, min(20.0, remaining))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        event_id = event_name = data = None
        for raw in response:
            if time.time() >= deadline:
                return False, last_seq
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line.startswith(":"):
                continue
            if line == "":
                if event_name == "done":
                    return True, last_seq
                if event_name and data is not None:
                    payload = json.loads(data)
                    if event_id:
                        last_seq = int(event_id)
                    _event_record(advisory, event_name, payload)
                    log(f"event #{event_id} {event_name}: {payload.get('state') or 'artifact'}")
                event_id = event_name = data = None
                continue
            if line.startswith("id: "):
                event_id = line[4:].strip()
            elif line.startswith("event: "):
                event_name = line[7:].strip()
            elif line.startswith("data: "):
                data = line[6:]
    return False, last_seq


def wait_for_terminal(
    descriptor,
    task_id,
    deadline,
    *,
    resume_from=0,
    poll_interval=5.0,
    base_record=None,
    max_stream_reconnects=3,
):
    """Return (record, last_seq); all retries are bounded by the absolute deadline."""
    advisory = dict(base_record or {})
    advisory.setdefault("taskId", task_id)
    last_seq = resume_from
    reconnects = 0
    while time.time() < deadline and reconnects <= max_stream_reconnects:
        try:
            done, last_seq = _stream_once(
                descriptor, task_id, last_seq, deadline, advisory
            )
            if done:
                try:
                    remaining = max(0.05, min(5.0, deadline - time.time()))
                    return rpc(descriptor, "GetTask", {"taskId": task_id}, remaining), last_seq
                except ClientError:
                    if advisory.get("state") in TERMINAL:
                        advisory["_harness_local_terminal"] = _LOCAL_TERMINAL_MARKER
                        return advisory, last_seq
            reconnects += 1
        except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError) as exc:
            reconnects += 1
            log(f"stream interrupted ({exc}); resuming after event {last_seq}")

    while time.time() < deadline:
        remaining = deadline - time.time()
        try:
            record = rpc(
                descriptor,
                "GetTask",
                {"taskId": task_id},
                timeout=max(0.05, min(5.0, remaining)),
            )
            if isinstance(record, dict) and record.get("state") in TERMINAL:
                return record, last_seq
        except ClientError as exc:
            log(f"bounded GetTask retry failed: {exc}")
        time.sleep(max(0.0, min(poll_interval, deadline - time.time())))
    return None, last_seq


def cancel_at_deadline(descriptor, task_id, grace_s, base_record):
    cancel = rpc(
        descriptor,
        "CancelTask",
        {"taskId": task_id},
        timeout=max(0.05, grace_s),
    )
    _require_remote_task_id(cancel, task_id, "CancelTask")
    synthetic = dict(base_record or {})
    synthetic.update(cancel or {})
    cancel_reason = (cancel or {}).get("termination_reason")
    local_reason = (
        cancel_reason
        if (cancel or {}).get("deduplicated") and cancel_reason
        else "client_deadline"
    )
    synthetic.update(
        taskId=task_id,
        agent=synthetic.get("agent") or descriptor["id"],
        state=(cancel or {}).get("state") or "CANCELED",
        termination_reason=local_reason,
        events_complete=(cancel or {}).get("events_complete", True),
    )
    if synthetic.get("state") == "CANCELED":
        try:
            record = rpc(
                descriptor, "GetTask", {"taskId": task_id}, timeout=max(0.05, grace_s)
            )
            _require_remote_task_id(record, task_id, "GetTask")
            record["termination_reason"] = local_reason
            return record
        except ClientError as exc:
            log(f"cancel was confirmed; preserving CANCELED despite final GetTask failure: {exc}")
            synthetic["_harness_local_terminal"] = _LOCAL_TERMINAL_MARKER
            return synthetic
    record = rpc(
        descriptor, "GetTask", {"taskId": task_id}, timeout=max(0.05, grace_s)
    )
    _require_remote_task_id(record, task_id, "GetTask")
    return record


def deadline_exit_code(record):
    return 124 if (
        record.get("state") == "CANCELED"
        and record.get("termination_reason") == "client_deadline"
    ) else 0


def _load_envelope(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        raise ClientError(f"envelope unreadable ({path}): {exc}")


def _json_object_without_duplicate_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def _active_v2_checkpoint_present(project_root):
    """Return whether this project has a v2-shaped active mode checkpoint.

    The authoritative validation remains ``resolve-active-mode-role.sh``.  We
    only need this bounded local shape check when a diagnostic A2A command has
    no envelope and therefore no role to pass to that resolver.
    """
    progress = os.path.join(project_root, "progress.json")
    if not os.path.isfile(progress):
        return False
    try:
        with open(progress, encoding="utf-8") as stream:
            value = json.load(stream, object_pairs_hook=_json_object_without_duplicate_keys)
    except (OSError, ValueError) as exc:
        raise ClientError(f"progress unreadable ({progress}): {exc}") from exc
    if not isinstance(value, dict):
        return False
    mode = value.get("mode_intent")
    return isinstance(mode, dict) and (
        "signed_intent" in mode or "resolution" in mode
    )


def _fixed_role_from_target_id(agent):
    """Infer the role only from a generated canonical A2A target id."""
    if not isinstance(agent, str) or not agent.startswith(A2A_TARGET_PREFIX):
        return None
    _target_id, fixed_role = _target_selector(agent)
    return fixed_role


def network_command_role(args):
    """Recover a local role before any descriptor-driven network operation."""
    if args.cmd in ("run", "send", "get", "subscribe"):
        if not args.envelope:
            raise ClientError("--envelope is required")
        envelope = _load_envelope(os.path.abspath(args.envelope))
        if not isinstance(envelope, dict):
            raise ClientError("envelope root must be an object")
        role = envelope.get("role")
        if role not in A2A_ROLES:
            raise ClientError(
                "a2a transport does not support generator until a source-handoff "
                "protocol can return implementation changes safely"
            )
        if args.role is not None and args.role != role:
            raise ClientError("--role must match the envelope role")
        return role

    fixed_role = _fixed_role_from_target_id(args.agent)
    if args.role is not None and fixed_role is not None and args.role != fixed_role:
        raise ClientError("--role must match the generated A2A target role")
    return fixed_role or args.role


def active_mode_expected_provenance(project_root, registry, adapters, agent, role):
    """Replay active v2 target authority before direct A2A networking.

    Active non-fast mode owns the role-to-agent binding and its semantic
    provenance.  Direct clients must recover that same authority rather than
    allowing a hand-written ``--agent`` to select a different remote endpoint.
    """
    if not _active_v2_checkpoint_present(project_root):
        return None
    if role not in A2A_ROLES:
        raise ClientError(
            "active v2 A2A checkpoint requires --role for card, ls, or cancel "
            "when --agent is not a generated role target"
        )

    progress = os.path.join(project_root, "progress.json")
    resolver = os.path.join(DISPATCH_DIR, "resolve-active-mode-role.sh")
    if not os.path.isfile(resolver):
        raise ClientError(f"framework active-mode resolver missing: {resolver}")
    command = [
        "bash", resolver,
        "--role", role,
        "--expected-agent", agent,
        "--progress", progress,
        "--registry", os.fspath(registry),
        "--adapters", os.fspath(adapters),
    ]
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ClientError(f"active mode role preflight could not run: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "active mode resolver failed").strip()
        raise ClientError(f"active mode role preflight failed: {detail[:600]}")
    try:
        record = json.loads(result.stdout)
    except (TypeError, ValueError) as exc:
        raise ClientError(f"active mode role returned invalid JSON: {exc}") from exc
    if record == {}:
        raise ClientError(
            "active v2 checkpoint disappeared during role revalidation; retry after re-planning"
        )
    if not isinstance(record, dict) or set(record) != ACTIVE_MODE_RECORD_FIELDS:
        raise ClientError("active mode role returned an incomplete binding record")
    try:
        active_agent = _safe_config_id(record["agent_id"], "active mode role agent_id")
        _safe_tool_id(record["tool"], "active mode role tool")
        _bounded_text(record["model_family"], "active mode role model_family", 128)
    except ClientError as exc:
        raise ClientError(f"active mode role returned an invalid binding record: {exc}") from exc
    if active_agent != agent:
        raise ClientError("active mode role returned a different agent")
    if record["invocation"] != "a2a":
        raise ClientError("active mode role is not bound to the a2a invocation")
    if isinstance(record["priority"], bool) or not isinstance(record["priority"], int) or record["priority"] < 0:
        raise ClientError("active mode role returned an invalid priority")
    provenance = record.get("execution_provenance_sha256")
    if not isinstance(provenance, str) or not EXECUTION_PROVENANCE_SHA256.fullmatch(provenance):
        raise ClientError(
            "active v2 role lacks a valid execution_provenance_sha256; re-plan first"
        )
    return provenance


def validate_dispatchable_role(descriptor, envelope):
    role = envelope.get("role")
    if role == "generator":
        raise ClientError(
            "a2a transport does not support generator until a source-handoff "
            "protocol can return implementation changes safely"
        )
    if role not in (descriptor.get("roles") or []):
        raise ClientError(
            f"{descriptor.get('id')} does not declare envelope role={role!r}"
        )


def load_commissioned_envelope(descriptor, envelope_path, *, project_root=None):
    envelope_path = os.path.abspath(envelope_path)
    envelope = _load_envelope(envelope_path)
    commission = commission_from_envelope(
        envelope, envelope_path, project_root=project_root
    )
    validate_dispatchable_role(descriptor, envelope)
    return envelope, commission


def commissioned_base_record(descriptor, commission):
    return {
        "taskId": commission["task_id"],
        "agent": descriptor["id"],
        "model_family": descriptor.get("model_family"),
        "batch": commission["batch"],
        "role": commission["role"],
        "deliverable": commission["deliverable"],
    }


def validate_remote_card_before_deadline(descriptor, role, deadline):
    """Verify the remote identity without allowing Agent Card I/O to extend a task."""
    remaining = deadline - time.time()
    if remaining <= 0:
        raise ClientError("A2A task deadline elapsed before Agent Card verification")
    validate_remote_card(descriptor, role, timeout=max(0.05, min(15.0, remaining)))
    if time.time() >= deadline:
        raise ClientError("A2A task deadline elapsed during Agent Card verification")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=["run", "send", "subscribe", "get", "cancel", "card", "ls"])
    parser.add_argument("--agent", required=True)
    parser.add_argument("--envelope")
    parser.add_argument("--task")
    parser.add_argument("--registry", default=".agents-registry.json")
    parser.add_argument("--adapters", default=DEFAULT_ADAPTERS_DIR)
    parser.add_argument("--role", choices=A2A_ROLES)
    parser.add_argument("--expected-provenance")
    parser.add_argument("--state", default=STATE_DIR_DEFAULT)
    parser.add_argument("--project-root")
    parser.add_argument("--resume-from", type=int, default=0)
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--transport-grace", type=float, default=TRANSPORT_GRACE_S)
    parser.add_argument("--max-stream-reconnects", type=int, default=3)
    args = parser.parse_args()
    if args.poll_interval < 0 or args.transport_grace <= 0 or args.max_stream_reconnects < 0:
        parser.error("wait controls must be non-negative and transport grace must be positive")

    try:
        # Descriptor data selects the remote endpoint and must be bound to the
        # same project root that owns any commissioned artifact.
        root_arg = args.project_root if args.project_root is not None else os.getcwd()
        args.registry = project_registry_path(root_arg, args.registry)
        project_root = os.path.dirname(args.registry)
        role = network_command_role(args)
        active_provenance = active_mode_expected_provenance(
            project_root, args.registry, args.adapters, args.agent, role
        )
        expected_provenance = args.expected_provenance
        if active_provenance is not None:
            if (
                expected_provenance is not None
                and expected_provenance != active_provenance
            ):
                raise ClientError(
                    "--expected-provenance does not match the active v2 checkpoint"
                )
            expected_provenance = active_provenance

        if expected_provenance is not None:
            target = verify_expected_execution_provenance(
                args.registry,
                args.agent,
                args.adapters,
                expected_provenance,
                expected_role=role,
            )
            descriptor = descriptor_from_canonical_target(target)
        else:
            descriptor = load_descriptor(args.registry, args.agent, adapters=args.adapters)

        if args.cmd == "card":
            print(json.dumps(fetch_agent_card(descriptor), ensure_ascii=False, indent=2))
            return 0
        if args.cmd == "ls":
            print(json.dumps(rpc(descriptor, "ListTasks", {}), ensure_ascii=False, indent=2))
            return 0

        if args.cmd in ("send", "run"):
            if not args.envelope:
                raise ClientError("--envelope is required")
            envelope_path = os.path.abspath(args.envelope)
            envelope, commission = load_commissioned_envelope(
                descriptor, envelope_path, project_root=project_root
            )
            timeout_s = effective_timeout(
                envelope.get("deadline_s"), descriptor.get("timeout_s")
            )
            started = time.time()
            deadline = started + timeout_s + args.transport_grace
            validate_remote_card_before_deadline(
                descriptor, commission["role"], deadline
            )
            result = rpc(
                descriptor,
                "SendMessage",
                {"envelope": envelope},
                timeout=max(0.05, min(30.0, deadline - time.time())),
            )
            _require_remote_task_id(
                result, commission["task_id"], "SendMessage"
            )
            task_id = commission["task_id"]
            if result.get("deduplicated"):
                log(f"task {task_id} deduplicated at state={result.get('state')}")
            else:
                log(f"task {task_id} submitted to {descriptor['endpoint']}")
            if args.cmd == "send":
                print(json.dumps({
                    "taskId": task_id,
                    "state": result.get("state"),
                    "agent": args.agent,
                    "endpoint": descriptor["endpoint"],
                }, ensure_ascii=False))
                return 0
            base = commissioned_base_record(descriptor, commission)
            record, _last = wait_for_terminal(
                descriptor,
                task_id,
                deadline,
                resume_from=args.resume_from,
                poll_interval=args.poll_interval,
                base_record=base,
                max_stream_reconnects=args.max_stream_reconnects,
            )
            if record is None:
                record = cancel_at_deadline(descriptor, task_id, args.transport_grace, base)
                synth_run_meta(
                    descriptor, record, args.state, effective_timeout_s=timeout_s,
                    commission=commission,
                    locally_synthesized=(
                        record.get("_harness_local_terminal")
                        is _LOCAL_TERMINAL_MARKER
                    ),
                )
                return deadline_exit_code(record)
            synth_run_meta(
                descriptor, record, args.state, effective_timeout_s=timeout_s,
                commission=commission,
                locally_synthesized=(
                    record.get("_harness_local_terminal")
                    is _LOCAL_TERMINAL_MARKER
                ),
            )
            return 0

        if not args.task:
            raise ClientError("--task is required")
        if args.cmd == "cancel":
            print(json.dumps(
                rpc(descriptor, "CancelTask", {"taskId": args.task}), ensure_ascii=False
            ))
            return 0
        if args.cmd == "get":
            if not args.envelope:
                raise ClientError("--envelope is required for get")
            envelope, commission = load_commissioned_envelope(
                descriptor, args.envelope, project_root=project_root
            )
            validate_remote_card(descriptor, commission["role"])
            if args.task != commission["task_id"]:
                raise ClientError("--task must equal the local envelope task_id")
            record = rpc(descriptor, "GetTask", {"taskId": args.task})
            _require_remote_task_id(record, commission["task_id"], "GetTask")
            if record.get("state") in TERMINAL:
                synth_run_meta(descriptor, record, args.state, commission=commission)
            else:
                log(f"task {args.task} remains {record.get('state')}")
                print(json.dumps({
                    "taskId": commission["task_id"],
                    "state": record.get("state"),
                    "submitted_at": record.get("submitted_at"),
                    "started_at": record.get("started_at"),
                }, ensure_ascii=False))
            return 0
        if args.cmd == "subscribe":
            if not args.envelope:
                raise ClientError("--envelope is required for subscribe")
            envelope_path = os.path.abspath(args.envelope)
            envelope, commission = load_commissioned_envelope(
                descriptor, envelope_path, project_root=project_root
            )
            if args.task != commission["task_id"]:
                raise ClientError("--task must equal the local envelope task_id")
            timeout_s = effective_timeout(
                envelope.get("deadline_s"),
                descriptor.get("timeout_s"),
            )
            deadline = time.time() + timeout_s + args.transport_grace
            validate_remote_card_before_deadline(
                descriptor, commission["role"], deadline
            )
            base = commissioned_base_record(descriptor, commission)
            record, _last = wait_for_terminal(
                descriptor,
                args.task,
                deadline,
                resume_from=args.resume_from,
                poll_interval=args.poll_interval,
                base_record=base,
                max_stream_reconnects=args.max_stream_reconnects,
            )
            if record is None:
                record = cancel_at_deadline(
                    descriptor, args.task, args.transport_grace, base
                )
                synth_run_meta(
                    descriptor, record, args.state, effective_timeout_s=timeout_s,
                    commission=commission,
                    locally_synthesized=(
                        record.get("_harness_local_terminal")
                        is _LOCAL_TERMINAL_MARKER
                    ),
                )
                return deadline_exit_code(record)
            synth_run_meta(
                descriptor, record, args.state, effective_timeout_s=timeout_s,
                commission=commission,
                locally_synthesized=(
                    record.get("_harness_local_terminal")
                    is _LOCAL_TERMINAL_MARKER
                ),
            )
            return 0
    except (ClientError, DispatchContractError, urllib.error.URLError, OSError, ValueError) as exc:
        die(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
