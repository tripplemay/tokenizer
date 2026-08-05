#!/usr/bin/env python3
"""Build a capability catalog and resolve signed role bindings.

The console signs a stable tool/invocation pair, never an implementation id.
This helper accepts both registry generations:

* ``dispatch/1`` keeps the historical role-specific ``agents`` descriptors.
* ``tool-integrations/1`` models neutral CLI integrations plus independent
  ``a2a_targets``.  The framework derives the role policy and opaque target
  ids; users never select those ids.

Examples:
  tool-catalog.py catalog --registry .agents-registry.json
  tool-catalog.py resolve --registry .agents-registry.json --bindings bindings.json
  tool-catalog.py target --registry .agents-registry.json --target-id local-cli--codex--generator
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
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dispatch_common import (
    A2A_AUTH_UNSET,
    DispatchContractError,
    a2a_auth_config,
    effective_timeout,
    external_environment_allowlist,
    external_environment_set,
)


ROLES = ("planner", "generator", "evaluator")
NON_GENERATOR_ROLES = ("planner", "evaluator")
INVOCATIONS = ("subagent", "local-cli", "a2a")
ENVELOPE_DELIVERIES = ("stdin", "argv", "env")
BRIDGE_RESPONSE_FORMATS = ("json",)
SAME_SESSION_SCOPE = "same-session"
# A manifest is a project declaration, not permission to turn on an arbitrary
# framework driver.  Only protocol kinds that this released framework has
# independently exercised may reach the catalog or sandbox.  More CLIs can
# join this published ACP capability declaratively; a new wire protocol needs
# a framework release with its own runner and probe first.
PUBLISHED_BRIDGE_PROTOCOL_KINDS = frozenset({"acp-native-agent/v1"})
STRICT_EXTERNAL_BRIDGE_PROVIDER_KINDS = frozenset({"vm-v1", "ephemeral-uid-v1"})
EXTERNAL_BRIDGE_PROVIDER_ATTESTATION_VERSION = "harness/external-bridge-provider-attestation/1"
EXTERNAL_BRIDGE_PROVIDER_MAX_TTL_SECONDS = 300
# A vm-v1 launch proof remains valid for at most five minutes and the broker
# lease must be revoked before that proof can become stale. Keep every
# registry-derived external target below that window while leaving the same
# integration's ordinary local-cli timeout unchanged.
VM_V1_MAX_TASK_SECONDS = 180
EXECUTION_PROVENANCE_FIELD = "execution_provenance_sha256"
EXECUTION_PROVENANCE_DOMAIN = "harness/execution-provenance/v1"
ADAPTER_CONTRACT_DOMAIN = "harness/adapter-execution-contract/v1"
TOOL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SAFE_CAPABILITY = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
BRIDGE_PROTOCOL_KIND = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
LEGACY_REGISTRY_VERSION = "dispatch/1"
INTEGRATION_REGISTRY_VERSION = "tool-integrations/1"
SUBAGENT_PERSONAS = {
    "planner": "planner-proposal",
    "generator": "generator-restricted",
    "evaluator": "evaluator",
}
INTEGRATION_FIELDS = {
    "id",
    "tool",
    "label",
    "model_family",
    "priority",
    "capabilities",
    "local_cli",
    "subagent",
    "notes",
}
LOCAL_CLI_FIELDS = {"adapter", "sandbox", "timeout_s"}
BRIDGE_MANIFEST_FIELDS = {
    "_comment",
    "id",
    "_verified",
    "session_scope",
    "strategy",
    "protocol",
    "personas",
    "native_agent_types",
    "deliverable_channels",
    "notes",
}
BRIDGE_PROTOCOL_FIELDS = {"kind", "command", "request_delivery", "response_format"}
# How a bridged child hands its commissioned artifact back. "file" children
# write it themselves; "terminal-message" personas (read-only vendor
# profiles) have the driver materialize their final message at the artifact
# path. Adjudicated in BL-NATIVE-SUBAGENT-BRIDGES FIX2 #1:A.
BRIDGE_DELIVERABLE_CHANNELS = {"file", "terminal-message"}
EXTERNAL_PROVIDER_ROUTE_FIELDS = {"tool", "protocol"}
A2A_TARGET_FIELDS = {
    "id",
    "integration_id",
    "remote_runner_id",
    "endpoint",
    "auth",
    "priority",
    "capabilities",
    "notes",
}


class ToolCatalogError(ValueError):
    """A registry or binding cannot safely produce a dispatch decision."""


def canonical_semantic_sha256(domain: str, value: Any) -> str:
    """Hash a stable execution contract without making documentation semantic.

    The NUL-separated domain makes a digest from one contract family
    ineligible as a digest from another one. ``value`` only contains validated
    JSON primitives sourced from registry, adapter, or bridge declarations.
    """
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(domain.encode("ascii") + b"\0" + canonical).hexdigest()


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def load_json(path: Path, label: str) -> Any:
    try:
        with path.open(encoding="utf-8") as stream:
            return json.load(stream, object_pairs_hook=reject_duplicate_keys)
    except FileNotFoundError as exc:
        raise ToolCatalogError(f"{label} does not exist: {path}") from exc
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise ToolCatalogError(f"{label} is invalid JSON: {path}: {exc}") from exc


def nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ToolCatalogError(f"{label} must be a non-empty string")
    return value.strip()


def bounded_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ToolCatalogError(f"{label} must be a non-empty string")
    if len(value.strip()) > maximum or CONTROL_CHARACTERS.search(value):
        raise ToolCatalogError(
            f"{label} must be a non-empty string of at most {maximum} characters "
            "without control characters"
        )
    return value.strip()


def tool_id(value: Any, label: str) -> str:
    value = nonempty_string(value, label)
    if not TOOL_ID.fullmatch(value):
        raise ToolCatalogError(
            f"{label} must match {TOOL_ID.pattern!r}; it is used as a stable tool id"
        )
    return value


def stable_agent_id(value: Any, label: str) -> str:
    value = nonempty_string(value, label)
    if not AGENT_ID.fullmatch(value):
        raise ToolCatalogError(
            f"{label} must match {AGENT_ID.pattern!r}; it enters controlled "
            "dispatch shell arguments and state paths"
        )
    return value


def priority(value: Any, label: str, *, default: int = 1000) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ToolCatalogError(f"{label} must be a non-negative integer")
    return value


def exact_fields(value: Any, allowed: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolCatalogError(f"{label} must be an object")
    extra = sorted(set(value) - allowed)
    if extra:
        raise ToolCatalogError(f"{label} contains unsupported fields: {extra}")
    return value


def capabilities(value: Any, label: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > 64:
        raise ToolCatalogError(f"{label} must be a string array")
    parsed: set[str] = set()
    for index, item in enumerate(value):
        item = nonempty_string(item, f"{label}[{index}]")
        if not SAFE_CAPABILITY.fullmatch(item):
            raise ToolCatalogError(
                f"{label}[{index}] must match {SAFE_CAPABILITY.pattern!r}"
            )
        parsed.add(item)
    return tuple(sorted(parsed))


def valid_sandbox(value: Any, label: str, *, require_home: bool) -> dict[str, Any] | None:
    if value is None:
        if require_home:
            raise ToolCatalogError(f"{label}.home_dir is required for local-cli")
        return None
    sandbox = exact_fields(value, {"home_dir", "env_allow", "env_set"}, label)
    home = sandbox.get("home_dir")
    if require_home:
        home = nonempty_string(home, f"{label}.home_dir")
        if not home.startswith(("/", "~")):
            raise ToolCatalogError(f"{label}.home_dir must start with '/' or '~'")
    elif home is not None:
        home = nonempty_string(home, f"{label}.home_dir")
        if not home.startswith(("/", "~")):
            raise ToolCatalogError(f"{label}.home_dir must start with '/' or '~'")
    try:
        external_environment_allowlist(sandbox.get("env_allow"), f"{label}.env_allow")
        external_environment_set(sandbox.get("env_set"), f"{label}.env_set")
    except DispatchContractError as exc:
        raise ToolCatalogError(str(exc)) from exc
    return sandbox


def timeout_s(value: Any, label: str) -> int:
    try:
        return effective_timeout(None, value)
    except DispatchContractError as exc:
        raise ToolCatalogError(f"{label}: {exc}") from exc


def external_bridge_timeout(value: int | None, provider: "StrictExternalBridgeProvider") -> int | None:
    """Return the provider-owned hard cap for an external bridge target.

    The local CLI descriptor remains the source of its own timeout.  A
    provider route is a different isolation/lifecycle contract, so it must
    never inherit a duration that outlives the provider's nonce attestation.
    ``vm-v1`` is the only published external provider in this release.
    """
    if value is None:
        return None
    if provider.kind == "vm-v1":
        return min(value, VM_V1_MAX_TASK_SECONDS)
    return value


def endpoint(value: Any, label: str) -> str:
    return bounded_text(value, label, 2_048)


def default_adapters_dir() -> Path:
    return Path(__file__).resolve().parent / "transports" / "adapters"


def default_bridges_dir() -> Path:
    return Path(__file__).resolve().parent / "transports" / "bridges"


@dataclass(frozen=True)
class AttestedExternalBridgeRoute:
    """One executable tool/protocol pair measured by a strict provider."""

    tool: str
    protocol_kind: str
    command: tuple[str, ...]
    request_delivery: str
    response_format: str

    def matches(self, tool: str, protocol: dict[str, Any]) -> bool:
        return (
            self.tool == tool
            and self.protocol_kind == protocol.get("kind")
            and self.command == tuple(protocol.get("command", ()))
            and self.request_delivery == protocol.get("request_delivery")
            and self.response_format == protocol.get("response_format")
        )


@dataclass(frozen=True)
class StrictExternalBridgeProvider:
    """A framework-integrated, freshly attested external-bridge provider.

    This is deliberately not a project-registry object.  A future VM or
    ephemeral-principal provider is responsible for proving the full provider
    contract at both catalog resolution and launch.  The catalog carries only
    stable identity and contract digest into the signed execution semantics.
    """

    id: str
    kind: str
    contract_sha256: str
    supported_routes: tuple[AttestedExternalBridgeRoute, ...] = ()

    def supports(self, tool: str, protocol: dict[str, Any]) -> bool:
        return any(route.matches(tool, protocol) for route in self.supported_routes)


APP_DISPATCH_RELATIVE = Path("framework/templates/claude/dispatch")
APP_RUNTIME_FILES = (
    Path("tool-catalog.py"),
    Path("validate-active-return-route.py"),
    Path("transports/vm-bridge-provider.py"),
    Path("transports/session-bridge.py"),
    Path("transports/session_bridge_kimi.py"),
    Path("transports/vm-bridge-worker.py"),
)


def attested_external_bridge_routes(value: Any) -> tuple[AttestedExternalBridgeRoute, ...]:
    """Validate bundle-bound provider routes before exposing them in a catalog."""
    if not isinstance(value, list) or not value or len(value) > 64:
        raise ToolCatalogError("external bridge provider supported_routes must be a non-empty array")
    routes: list[AttestedExternalBridgeRoute] = []
    seen: set[tuple[str, str, tuple[str, ...], str, str]] = set()
    for index, raw in enumerate(value):
        label = f"external bridge provider supported_routes[{index}]"
        route = exact_fields(raw, EXTERNAL_PROVIDER_ROUTE_FIELDS, label)
        tool = tool_id(route.get("tool"), f"{label}.tool")
        protocol = exact_fields(route.get("protocol"), BRIDGE_PROTOCOL_FIELDS, f"{label}.protocol")
        kind = bridge_protocol_kind(protocol.get("kind"), f"{label}.protocol.kind")
        if kind not in PUBLISHED_BRIDGE_PROTOCOL_KINDS:
            raise ToolCatalogError(f"{label}.protocol.kind is not published")
        command = bridge_command(protocol.get("command"), f"{label}.protocol.command")
        request_delivery = protocol.get("request_delivery")
        if request_delivery not in ENVELOPE_DELIVERIES:
            raise ToolCatalogError(f"{label}.protocol.request_delivery is invalid")
        response_format = protocol.get("response_format")
        if response_format not in BRIDGE_RESPONSE_FORMATS:
            raise ToolCatalogError(f"{label}.protocol.response_format is invalid")
        if command[0] != tool:
            raise ToolCatalogError(f"{label}.tool must match its executable command")
        key = (tool, kind, command, request_delivery, response_format)
        if key in seen:
            raise ToolCatalogError(f"{label} is duplicated")
        seen.add(key)
        routes.append(
            AttestedExternalBridgeRoute(
                tool=tool,
                protocol_kind=kind,
                command=command,
                request_delivery=request_delivery,
                response_format=response_format,
            )
        )
    return tuple(sorted(routes, key=lambda route: (
        route.tool,
        route.protocol_kind,
        route.command,
        route.request_delivery,
        route.response_format,
    )))


def _secure_app_runtime(root: Path) -> bool:
    """Prove the fixed installed app bundle is not a project-controlled path."""
    current = root
    for part in APP_DISPATCH_RELATIVE.parts:
        try:
            entry = current.lstat()
        except OSError:
            return False
        if (
            stat.S_ISLNK(entry.st_mode)
            or not stat.S_ISDIR(entry.st_mode)
            or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            return False
        current = current / part
    try:
        entry = current.lstat()
    except OSError:
        return False
    if (
        stat.S_ISLNK(entry.st_mode)
        or not stat.S_ISDIR(entry.st_mode)
        or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        return False
    for relative in APP_RUNTIME_FILES:
        candidate = root / APP_DISPATCH_RELATIVE / relative
        parent = candidate.parent
        while parent != root / APP_DISPATCH_RELATIVE:
            try:
                parent_entry = parent.lstat()
            except OSError:
                return False
            if (
                stat.S_ISLNK(parent_entry.st_mode)
                or not stat.S_ISDIR(parent_entry.st_mode)
                or parent_entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
            ):
                return False
            parent = parent.parent
        try:
            entry = candidate.lstat()
        except OSError:
            return False
        if (
            stat.S_ISLNK(entry.st_mode)
            or not stat.S_ISREG(entry.st_mode)
            or entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
        ):
            return False
    return True


def _same_regular_bytes(left: Path, right: Path) -> bool:
    try:
        left_entry = left.lstat()
        right_entry = right.lstat()
    except OSError:
        return False
    if (
        stat.S_ISLNK(left_entry.st_mode)
        or stat.S_ISLNK(right_entry.st_mode)
        or not stat.S_ISREG(left_entry.st_mode)
        or not stat.S_ISREG(right_entry.st_mode)
        or left_entry.st_size != right_entry.st_size
    ):
        return False
    digest = hashlib.sha256()
    try:
        with left.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        left_digest = digest.digest()
        digest = hashlib.sha256()
        with right.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        return False
    return left_digest == digest.digest()


def _installed_provider_path() -> Path | None:
    """Find the app-owned provider and verify an optional project mirror."""
    try:
        home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    except (KeyError, OSError):
        return None
    app_root = home / ".tokenizer" / "app"
    if not _secure_app_runtime(app_root):
        return None
    app_dispatch = app_root / APP_DISPATCH_RELATIVE
    local_dispatch = Path(__file__).absolute().parent
    if local_dispatch != app_dispatch:
        for relative in APP_RUNTIME_FILES:
            if not _same_regular_bytes(local_dispatch / relative, app_dispatch / relative):
                return None
    return app_dispatch / "transports" / "vm-bridge-provider.py"


def external_same_session_bridge_provider() -> StrictExternalBridgeProvider | None:
    """Return a trusted strict provider after a fresh framework-owned probe.

    The provider executable is fixed under the installed app bundle. A project
    mirror can only prove byte identity with that bundle; it is never executed.
    This function never consults the project registry, an adapter command,
    PATH, a device report, or an environment-selected provider. A missing
    runtime is a normal unavailable observation. A malformed *available*
    response is treated the same way: the catalog simply withholds external
    bridge choices.
    """
    provider = _installed_provider_path()
    if provider is None:
        return None
    try:
        entry = provider.lstat()
        if not provider.is_file() or provider.is_symlink():
            return None
        # The provider gets its durable configuration from a framework-fixed
        # passwd-derived location. Do not pass the caller's environment into a
        # process which becomes part of a signed execution decision.
        completed = subprocess.run(
            ["/usr/bin/python3", "-I", str(provider), "catalog-attest"],
            cwd=str(provider.parent),
            env={"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    try:
        raw = json.loads(completed.stdout)
    except (TypeError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    if raw.get("available") is False:
        return None
    if set(raw) != {"available", "provider", "attestation"} or raw.get("available") is not True:
        return None
    provider_record = raw.get("provider")
    attestation = raw.get("attestation")
    if not isinstance(provider_record, dict) or set(provider_record) != {
        "id", "kind", "contract_sha256"
    }:
        return None
    if not isinstance(attestation, dict) or set(attestation) != {
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
        "supported_routes",
    }:
        return None
    try:
        provider_id = tool_id(provider_record.get("id"), "external bridge provider id")
        provider_kind = bounded_text(
            provider_record.get("kind"), "external bridge provider kind", 128
        )
        contract_sha256 = provider_record.get("contract_sha256")
        if provider_kind != "vm-v1" or not isinstance(contract_sha256, str) or SHA256_HEX.fullmatch(contract_sha256) is None:
            return None
        if (
            attestation.get("version") != EXTERNAL_BRIDGE_PROVIDER_ATTESTATION_VERSION
            or attestation.get("provider_id") != provider_id
            or attestation.get("provider_kind") != provider_kind
            or attestation.get("contract_sha256") != contract_sha256
            or attestation.get("phase") != "catalog"
        ):
            return None
        for field in (
            "nonce_sha256",
            "image_sha256",
            "runner_sha256",
            "cli_bundle_sha256",
            "broker_policy_sha256",
        ):
            if not isinstance(attestation.get(field), str) or SHA256_HEX.fullmatch(attestation[field]) is None:
                return None
        issued = dt.datetime.fromisoformat(str(attestation["issued_at"]).replace("Z", "+00:00"))
        expires = dt.datetime.fromisoformat(str(attestation["expires_at"]).replace("Z", "+00:00"))
        if issued.tzinfo is None or expires.tzinfo is None:
            return None
        now = dt.datetime.now(dt.timezone.utc)
        if issued > now + dt.timedelta(seconds=30) or expires <= now or expires <= issued:
            return None
        if (expires - issued).total_seconds() > EXTERNAL_BRIDGE_PROVIDER_MAX_TTL_SECONDS:
            return None
        supported_routes = attested_external_bridge_routes(attestation.get("supported_routes"))
    except (TypeError, ValueError, OverflowError, ToolCatalogError):
        return None
    return StrictExternalBridgeProvider(
        id=provider_id,
        kind=provider_kind,
        contract_sha256=contract_sha256,
        supported_routes=supported_routes,
    )


def resolved_external_same_session_bridge_provider() -> StrictExternalBridgeProvider | None:
    """Validate the trusted provider observation before it reaches a target."""
    provider = external_same_session_bridge_provider()
    if provider is None:
        return None
    if not isinstance(provider, StrictExternalBridgeProvider):
        raise ToolCatalogError("external same-session bridge provider has an invalid type")
    if not isinstance(provider.contract_sha256, str) or not SHA256_HEX.fullmatch(
        provider.contract_sha256
    ):
        raise ToolCatalogError(
            "external same-session bridge provider contract_sha256 must be lower-case SHA-256"
        )
    kind = bounded_text(provider.kind, "external same-session bridge provider kind", 128)
    if kind not in STRICT_EXTERNAL_BRIDGE_PROVIDER_KINDS:
        raise ToolCatalogError(
            "external same-session bridge provider kind must be one of "
            f"{sorted(STRICT_EXTERNAL_BRIDGE_PROVIDER_KINDS)!r}"
        )
    routes = provider.supported_routes
    if not isinstance(routes, tuple) or not routes:
        raise ToolCatalogError("external same-session bridge provider has no supported routes")
    for route in routes:
        if not isinstance(route, AttestedExternalBridgeRoute):
            raise ToolCatalogError("external same-session bridge provider route is invalid")
        protocol = {
            "kind": route.protocol_kind,
            "command": list(route.command),
            "request_delivery": route.request_delivery,
            "response_format": route.response_format,
        }
        if (
            tool_id(route.tool, "external same-session bridge provider route tool") != route.tool
            or bridge_protocol_kind(
                route.protocol_kind, "external same-session bridge provider route protocol kind"
            )
            != route.protocol_kind
            or route.protocol_kind not in PUBLISHED_BRIDGE_PROTOCOL_KINDS
        ):
            raise ToolCatalogError("external same-session bridge provider route is invalid")
        try:
            parsed_routes = attested_external_bridge_routes(
                [{"tool": route.tool, "protocol": protocol}]
            )
        except ToolCatalogError as exc:
            raise ToolCatalogError("external same-session bridge provider route is invalid") from exc
        if parsed_routes != (route,):
            raise ToolCatalogError("external same-session bridge provider route is invalid")
    return StrictExternalBridgeProvider(
        id=tool_id(provider.id, "external same-session bridge provider id"),
        kind=kind,
        contract_sha256=provider.contract_sha256,
        supported_routes=routes,
    )


def generated_target_id(prefix: str, source_id: str, role: str) -> str:
    return stable_agent_id(f"{prefix}--{source_id}--{role}", "generated target id")


@dataclass(frozen=True)
class Candidate:
    # ``target_id`` is intentionally named ``agent_id`` only in resolve's
    # legacy-compatible audit output. It is an opaque runtime target, not a
    # selectable Agent Card.
    target_id: str
    integration_id: str
    roles: tuple[str, ...]
    tool: str
    invocation: str
    model_family: str
    priority: int
    capabilities: tuple[str, ...]
    label: str
    adapter: str | None = None
    sandbox: dict[str, Any] | None = None
    timeout_s: int | None = None
    endpoint: str | None = None
    auth: dict[str, str] | None = None
    remote_runner_id: str | None = None
    agent_type: str | None = None
    native_agent_type: str | None = None
    deliverable_channel: str | None = None
    bridge_id: str | None = None
    bridge_strategy: str | None = None
    session_scope: str | None = None
    bridge_protocol: dict[str, Any] | None = None
    bridge_provider_id: str | None = None
    bridge_provider_kind: str | None = None
    bridge_provider_contract_sha256: str | None = None
    adapter_execution_contract_sha256: str | None = None
    bridge_semantics: dict[str, Any] | None = None
    # Historical dispatch/1 host-native children remain Coordinator-internal
    # targets.  They must be resolvable by the Coordinator, but a v2 signed
    # tool binding must never turn them into a tool-labelled external route.
    v2_selectable: bool = True

    def public(self) -> dict[str, Any]:
        return {
            "agent_id": self.target_id,
            "tool": self.tool,
            "invocation": self.invocation,
            "model_family": self.model_family,
            "priority": self.priority,
            EXECUTION_PROVENANCE_FIELD: self.execution_provenance_sha256(),
        }

    def target_semantics(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "target_id": self.target_id,
            "integration_id": self.integration_id,
            "tool": self.tool,
            "invocation": self.invocation,
            "model_family": self.model_family,
            "priority": self.priority,
            "roles": list(self.roles),
        }
        if self.adapter is not None:
            value["adapter"] = self.adapter
        if self.sandbox is not None:
            value["sandbox"] = self.sandbox
        if self.timeout_s is not None:
            value["timeout_s"] = self.timeout_s
        if self.endpoint is not None:
            value["endpoint"] = self.endpoint
        if self.auth is not None:
            value["auth"] = self.auth
        if self.remote_runner_id is not None:
            value["remote_runner_id"] = self.remote_runner_id
        if self.agent_type is not None:
            value["agent_type"] = self.agent_type
        if self.native_agent_type is not None:
            value["native_agent_type"] = self.native_agent_type
        if self.deliverable_channel is not None:
            value["deliverable_channel"] = self.deliverable_channel
        if self.bridge_id is not None:
            value["bridge_id"] = self.bridge_id
        if self.bridge_strategy is not None:
            value["bridge_strategy"] = self.bridge_strategy
        if self.session_scope is not None:
            value["session_scope"] = self.session_scope
        if self.bridge_protocol is not None:
            value["bridge_protocol"] = self.bridge_protocol
        if self.bridge_provider_id is not None:
            value["bridge_provider_id"] = self.bridge_provider_id
        if self.bridge_provider_kind is not None:
            value["bridge_provider_kind"] = self.bridge_provider_kind
        if self.bridge_provider_contract_sha256 is not None:
            value["bridge_provider_contract_sha256"] = self.bridge_provider_contract_sha256
        if self.adapter_execution_contract_sha256 is not None:
            value["adapter_execution_contract_sha256"] = self.adapter_execution_contract_sha256
        if self.capabilities:
            value["capabilities"] = list(self.capabilities)
        return value

    def execution_provenance_payload(self) -> dict[str, Any]:
        return {
            "target": self.target_semantics(),
            "adapter_execution_contract_sha256": self.adapter_execution_contract_sha256,
            "bridge_semantics": self.bridge_semantics,
            "bridge_provider_contract_sha256": self.bridge_provider_contract_sha256,
        }

    def execution_provenance_sha256(self) -> str:
        return canonical_semantic_sha256(
            EXECUTION_PROVENANCE_DOMAIN, self.execution_provenance_payload()
        )

    def target_public(self) -> dict[str, Any]:
        value = self.target_semantics()
        value[EXECUTION_PROVENANCE_FIELD] = self.execution_provenance_sha256()
        return value


def adapter_path(adapters_dir: Path, name: str) -> Path:
    # Do not turn registry-controlled strings into a path traversal primitive.
    if not TOOL_ID.fullmatch(name):
        raise ToolCatalogError(f"adapter name {name!r} is not a safe adapter id")
    return adapters_dir / f"{name}.json"


def bridge_manifest_path(bridges_dir: Path, bridge_id: str) -> Path:
    # Bridge ids are registry-controlled. Keep them out of path syntax before
    # resolving the manifest path so a declaration cannot traverse directories.
    if not TOOL_ID.fullmatch(bridge_id):
        raise ToolCatalogError(f"bridge id {bridge_id!r} is not a safe bridge id")
    return bridges_dir / f"{bridge_id}.json"


@dataclass(frozen=True)
class SubagentBridge:
    id: str
    strategy: str
    session_scope: str
    protocol: dict[str, Any]
    personas: dict[str, str]
    native_agent_types: dict[str, str]
    deliverable_channels: dict[str, str]
    requires_local_cli: bool


def subagent_bridge_semantics(bridge: SubagentBridge) -> dict[str, Any]:
    """Return the manifest fields that can change a bridge's execution path."""
    return {
        "id": bridge.id,
        "strategy": bridge.strategy,
        "session_scope": bridge.session_scope,
        "protocol": bridge.protocol,
        "personas": bridge.personas,
        "native_agent_types": bridge.native_agent_types,
        "deliverable_channels": bridge.deliverable_channels,
        "requires_local_cli": bridge.requires_local_cli,
    }


def bridge_command(value: Any, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value or len(value) > 64:
        raise ToolCatalogError(f"{label} must be a non-empty string array of at most 64 items")
    command: list[str] = []
    for index, item in enumerate(value):
        command.append(bounded_text(item, f"{label}[{index}]", 4_096))
    return tuple(command)


def bridge_protocol_kind(value: Any, label: str) -> str:
    value = nonempty_string(value, label)
    if not BRIDGE_PROTOCOL_KIND.fullmatch(value):
        raise ToolCatalogError(f"{label} must match {BRIDGE_PROTOCOL_KIND.pattern!r}")
    return value


def load_subagent_bridge(bridges_dir: Path, bridge_id: str) -> SubagentBridge:
    path = bridge_manifest_path(bridges_dir, bridge_id)
    raw = load_json(path, f"subagent bridge {bridge_id!r}")
    manifest = exact_fields(raw, BRIDGE_MANIFEST_FIELDS, f"subagent bridge {bridge_id!r}")

    declared_id = tool_id(manifest.get("id"), f"subagent bridge {bridge_id!r}.id")
    if declared_id != bridge_id:
        raise ToolCatalogError(
            f"subagent bridge filename {bridge_id!r} disagrees with bridge.id={declared_id!r}"
        )
    if manifest.get("_verified") is not True:
        raise ToolCatalogError(
            f"subagent bridge {bridge_id!r} is not verified; it cannot enter the catalog"
        )
    if manifest.get("session_scope") != SAME_SESSION_SCOPE:
        raise ToolCatalogError(
            f"subagent bridge {bridge_id!r}.session_scope must be {SAME_SESSION_SCOPE!r}"
        )
    strategy = capabilities([manifest.get("strategy")], f"subagent bridge {bridge_id!r}.strategy")
    assert len(strategy) == 1
    if manifest.get("_comment") is not None and not isinstance(manifest.get("_comment"), str):
        raise ToolCatalogError(f"subagent bridge {bridge_id!r}._comment must be a string")
    if manifest.get("notes") is not None and not isinstance(manifest.get("notes"), str):
        raise ToolCatalogError(f"subagent bridge {bridge_id!r}.notes must be a string")

    protocol_label = f"subagent bridge {bridge_id!r}.protocol"
    protocol_raw = exact_fields(manifest.get("protocol"), BRIDGE_PROTOCOL_FIELDS, protocol_label)
    missing_protocol = sorted(BRIDGE_PROTOCOL_FIELDS - set(protocol_raw))
    if missing_protocol:
        raise ToolCatalogError(f"{protocol_label} is missing required fields: {missing_protocol}")
    protocol_kind = bridge_protocol_kind(protocol_raw.get("kind"), f"{protocol_label}.kind")
    if protocol_kind not in PUBLISHED_BRIDGE_PROTOCOL_KINDS:
        raise ToolCatalogError(
            f"{protocol_label}.kind={protocol_kind!r} is not published by this framework"
        )
    command = bridge_command(protocol_raw.get("command"), f"{protocol_label}.command")
    request_delivery = protocol_raw.get("request_delivery")
    if request_delivery not in ENVELOPE_DELIVERIES:
        raise ToolCatalogError(
            f"{protocol_label}.request_delivery must be one of {ENVELOPE_DELIVERIES!r}"
        )
    response_format = protocol_raw.get("response_format")
    if response_format not in BRIDGE_RESPONSE_FORMATS:
        raise ToolCatalogError(
            f"{protocol_label}.response_format must be one of {BRIDGE_RESPONSE_FORMATS!r}"
        )

    personas_label = f"subagent bridge {bridge_id!r}.personas"
    personas_raw = exact_fields(manifest.get("personas"), set(ROLES), personas_label)
    if not personas_raw:
        raise ToolCatalogError(f"{personas_label} must declare at least one role persona")
    personas: dict[str, str] = {}
    for role, persona in personas_raw.items():
        expected = SUBAGENT_PERSONAS[role]
        if persona != expected:
            raise ToolCatalogError(
                f"{personas_label}.{role} must be {expected!r} under the framework role contract"
            )
        personas[role] = persona

    native_types_label = f"subagent bridge {bridge_id!r}.native_agent_types"
    native_types_raw = exact_fields(
        manifest.get("native_agent_types"), set(personas), native_types_label
    )
    if set(native_types_raw) != set(personas):
        raise ToolCatalogError(
            f"{native_types_label} must declare exactly the bridge persona roles"
        )
    native_agent_types: dict[str, str] = {}
    for role, native_type in native_types_raw.items():
        parsed = bounded_text(native_type, f"{native_types_label}.{role}", 32)
        if parsed not in {"plan", "coder", "explore"}:
            raise ToolCatalogError(
                f"{native_types_label}.{role} must name a published native agent type"
            )
        native_agent_types[role] = parsed

    channels_label = f"subagent bridge {bridge_id!r}.deliverable_channels"
    channels_raw = manifest.get("deliverable_channels")
    deliverable_channels: dict[str, str] = {role: "file" for role in personas}
    if channels_raw is not None:
        if not isinstance(channels_raw, dict) or not set(channels_raw) <= set(personas):
            raise ToolCatalogError(
                f"{channels_label} may only declare the bridge persona roles"
            )
        for role, channel in channels_raw.items():
            parsed = bounded_text(channel, f"{channels_label}.{role}", 32)
            if parsed not in BRIDGE_DELIVERABLE_CHANNELS:
                raise ToolCatalogError(
                    f"{channels_label}.{role} must name a published deliverable channel"
                )
            deliverable_channels[role] = parsed

    return SubagentBridge(
        id=declared_id,
        strategy=strategy[0],
        session_scope=SAME_SESSION_SCOPE,
        protocol={
            "kind": protocol_kind,
            "command": list(command),
            "request_delivery": request_delivery,
            "response_format": response_format,
        },
        personas=personas,
        native_agent_types=native_agent_types,
        deliverable_channels=deliverable_channels,
        requires_local_cli=True,
    )


def validate_bridge_adapter_command(
    adapters_dir: Path,
    adapter_name: str,
    bridge: SubagentBridge,
) -> None:
    """Bind a bridge launch command to its verified local CLI adapter.

    A bridge manifest is selected by a project registry, so it must not be
    able to substitute an unrelated executable under another CLI's dedicated
    HOME and credential policy.  The adapter is the verified launch authority:
    it declares exact commands by published protocol kind and the command's
    executable must also equal the adapter's ordinary CLI executable.
    """
    adapter_label = f"adapter {adapter_name!r}"
    adapter = load_json(adapter_path(adapters_dir, adapter_name), adapter_label)
    if not isinstance(adapter, dict):
        raise ToolCatalogError(f"{adapter_label} must be an object")
    if adapter.get("_verified") is not True:
        raise ToolCatalogError(f"{adapter_label} is not verified")

    argv = adapter.get("argv")
    if not isinstance(argv, list) or not argv:
        raise ToolCatalogError(f"{adapter_label}.argv must be a non-empty string array")
    executable = bounded_text(argv[0], f"{adapter_label}.argv[0]", 4_096)

    raw_commands = adapter.get("bridge_commands")
    if not isinstance(raw_commands, dict):
        raise ToolCatalogError(
            f"{adapter_label}.bridge_commands must declare the published bridge command"
        )
    unpublished = sorted(set(raw_commands) - PUBLISHED_BRIDGE_PROTOCOL_KINDS)
    if unpublished:
        raise ToolCatalogError(
            f"{adapter_label}.bridge_commands contains unpublished protocol kinds: "
            f"{unpublished!r}"
        )
    commands: dict[str, tuple[str, ...]] = {}
    for kind, command in raw_commands.items():
        if not isinstance(kind, str):
            raise ToolCatalogError(f"{adapter_label}.bridge_commands keys must be protocol kinds")
        parsed_kind = bridge_protocol_kind(kind, f"{adapter_label}.bridge_commands key")
        commands[parsed_kind] = bridge_command(
            command, f"{adapter_label}.bridge_commands[{parsed_kind!r}]"
        )

    kind = str(bridge.protocol["kind"])
    declared = commands.get(kind)
    if declared is None:
        raise ToolCatalogError(
            f"{adapter_label}.bridge_commands does not declare {kind!r}"
        )
    expected = tuple(bridge.protocol["command"])
    if declared != expected:
        raise ToolCatalogError(
            f"{bridge.id!r}.protocol.command must exactly match "
            f"{adapter_label}.bridge_commands[{kind!r}]"
        )
    if declared[0] != executable:
        raise ToolCatalogError(
            f"{adapter_label}.bridge_commands[{kind!r}][0] must match {adapter_label}.argv[0]"
        )
    if kind == "acp-native-agent/v1" and (len(declared) < 2 or declared[1] != "acp"):
        raise ToolCatalogError(
            f"{adapter_label}.bridge_commands[{kind!r}] must invoke the ACP subcommand"
        )


ADAPTER_DOCUMENTATION_FIELDS = frozenset(
    {
        "_argv_placeholders",
        "_auth_note",
        "_comment",
        "_flags_rationale",
        "_not_used",
        "_security_note",
        "_verified_note",
        "display_name",
    }
)


def adapter_execution_contract_sha256(
    adapter: dict[str, Any],
    *,
    declared_name: str,
    adapter_tool: str,
    adapter_family: str,
    argv: list[str],
    envelope_delivery: str,
    env_allowlist_extra: list[str],
) -> str:
    """Hash execution-relevant adapter state while excluding explanatory text.

    Unknown non-documentation fields remain in the contract by default. This
    lets a future adapter add an execution knob without weakening the active
    checkpoint drift guard; it need only follow the established convention
    that explanatory fields are explicitly documentation-only.
    """
    contract = {
        key: value
        for key, value in adapter.items()
        if key not in ADAPTER_DOCUMENTATION_FIELDS
    }
    # Normalize optional aliases and unordered allowlist declarations so
    # semantically equivalent adapter JSON has one digest.
    contract.update(
        {
            "name": declared_name,
            "tool": adapter_tool,
            "model_family": adapter_family,
            "argv": list(argv),
            "envelope_delivery": envelope_delivery,
            "env_allowlist_extra": sorted(env_allowlist_extra),
        }
    )
    return canonical_semantic_sha256(ADAPTER_CONTRACT_DOMAIN, contract)


def load_adapter(
    adapters_dir: Path,
    adapter_name: str,
    *,
    configured_tool: str | None,
    model_family: str,
    owner_label: str,
) -> tuple[str, str, str]:
    path = adapter_path(adapters_dir, adapter_name)
    adapter = load_json(path, f"adapter {adapter_name!r}")
    if not isinstance(adapter, dict):
        raise ToolCatalogError(f"adapter {adapter_name!r} must be an object")

    declared_name = tool_id(adapter.get("name"), f"adapter {adapter_name!r}.name")
    if declared_name != adapter_name:
        raise ToolCatalogError(
            f"adapter filename {adapter_name!r} disagrees with adapter.name={declared_name!r}"
        )
    adapter_declares_tool = "tool" in adapter
    adapter_tool = tool_id(adapter.get("tool", declared_name), f"adapter {adapter_name!r}.tool")
    if configured_tool is not None and adapter_declares_tool and configured_tool != adapter_tool:
        raise ToolCatalogError(
            f"{owner_label} tool={configured_tool!r} disagrees with adapter "
            f"{adapter_name!r} tool={adapter_tool!r}"
        )

    adapter_family = bounded_text(
        adapter.get("model_family"), f"adapter {adapter_name!r}.model_family", 128
    )
    if adapter_family != model_family:
        raise ToolCatalogError(
            f"{owner_label} model_family={model_family!r} disagrees with "
            f"adapter {adapter_name!r} model_family={adapter_family!r}"
        )

    argv = adapter.get("argv")
    if not isinstance(argv, list) or not argv or any(not isinstance(item, str) or not item for item in argv):
        raise ToolCatalogError(f"adapter {adapter_name!r}.argv must be a non-empty string array")
    envelope_delivery = adapter.get("envelope_delivery")
    if envelope_delivery not in ENVELOPE_DELIVERIES:
        raise ToolCatalogError(
            f"adapter {adapter_name!r}.envelope_delivery must be one of "
            f"{ENVELOPE_DELIVERIES!r}"
        )
    if adapter.get("_verified") is not True:
        raise ToolCatalogError(
            f"adapter {adapter_name!r} is not verified; local-cli tools cannot enter the catalog"
        )
    try:
        env_allowlist_extra = external_environment_allowlist(
            adapter.get("env_allowlist_extra"),
            f"adapter {adapter_name!r}.env_allowlist_extra",
        )
    except DispatchContractError as exc:
        raise ToolCatalogError(str(exc)) from exc

    canonical = configured_tool if configured_tool is not None else adapter_tool
    label = adapter.get("display_name", canonical)
    return (
        canonical,
        bounded_text(label, f"adapter {adapter_name!r}.display_name", 128),
        adapter_execution_contract_sha256(
            adapter,
            declared_name=declared_name,
            adapter_tool=adapter_tool,
            adapter_family=adapter_family,
            argv=argv,
            envelope_delivery=envelope_delivery,
            env_allowlist_extra=env_allowlist_extra,
        ),
    )


def legacy_canonical_tool(
    descriptor: dict[str, Any], adapters_dir: Path
) -> tuple[str, str, str | None]:
    invocation = descriptor.get("transport")
    descriptor_id = descriptor.get("id")
    family = bounded_text(descriptor.get("model_family"), f"agent {descriptor_id!r}.model_family", 128)
    if invocation == "local-cli":
        adapter_name = tool_id(descriptor.get("adapter"), f"agent {descriptor_id!r}.adapter")
        raw_tool = descriptor.get("tool")
        configured_tool = tool_id(raw_tool, f"agent {descriptor_id!r}.tool") if raw_tool is not None else None
        return load_adapter(
            adapters_dir,
            adapter_name,
            configured_tool=configured_tool,
            model_family=family,
            owner_label=f"agent {descriptor_id!r}",
        )

    raw_tool = descriptor.get("tool")
    if raw_tool is not None:
        value = tool_id(raw_tool, f"agent {descriptor_id!r}.tool")
        return value, value, None
    if invocation == "subagent":
        return "claude-code", "claude-code", None
    return tool_id(family, f"agent {descriptor_id!r}.model_family"), family, None


def qualified_local_generator(descriptor: dict[str, Any]) -> bool:
    """A returnable external Generator must use the fixed sandbox-diff protocol."""
    constraints = descriptor.get("constraints")
    return (
        isinstance(constraints, dict)
        and constraints.get("write_src") is True
        and constraints.get("push") is False
        and constraints.get("l2") is False
    )


def legacy_candidates(registry: dict[str, Any], adapters_dir: Path) -> list[Candidate]:
    agents = registry.get("agents")
    if not isinstance(agents, list) or not agents:
        raise ToolCatalogError("agent registry agents must be a non-empty array")

    candidates: list[Candidate] = []
    seen_ids: set[str] = set()
    for index, descriptor in enumerate(agents):
        label = f"agents[{index}]"
        if not isinstance(descriptor, dict):
            raise ToolCatalogError(f"{label} must be an object")
        agent_id = stable_agent_id(descriptor.get("id"), f"{label}.id")
        if agent_id in seen_ids:
            raise ToolCatalogError(f"agent id is duplicated: {agent_id!r}")
        seen_ids.add(agent_id)

        raw_roles = descriptor.get("roles")
        if not isinstance(raw_roles, list) or not raw_roles:
            raise ToolCatalogError(f"agent {agent_id!r}.roles must be a non-empty array")
        roles = tuple(raw_roles)
        if any(role not in ROLES for role in roles) or len(set(roles)) != len(roles):
            raise ToolCatalogError(f"agent {agent_id!r}.roles contains unsupported or duplicate roles")

        invocation = descriptor.get("transport")
        if invocation not in INVOCATIONS:
            raise ToolCatalogError(f"agent {agent_id!r}.transport is unsupported: {invocation!r}")
        auth: dict[str, str] | None = None
        if invocation == "a2a":
            try:
                auth = a2a_auth_config(
                    descriptor.get("auth", A2A_AUTH_UNSET),
                    f"agent {agent_id!r}.auth",
                )
            except DispatchContractError as exc:
                raise ToolCatalogError(str(exc)) from exc
            endpoint_value = endpoint(descriptor.get("endpoint"), f"agent {agent_id!r}.endpoint")
        else:
            endpoint_value = None
            if "auth" in descriptor:
                raise ToolCatalogError(
                    f"agent {agent_id!r}.auth is only supported for transport='a2a'"
                )
        if invocation == "a2a" and "generator" in roles:
            raise ToolCatalogError(
                f"agent {agent_id!r} declares a2a+generator, but no source-handoff "
                "protocol exists to return implementation changes safely"
            )
        # Do not expose a local Generator tool that the source-handoff protocol
        # would reject. A multi-role descriptor may still serve its other roles.
        if invocation == "local-cli" and "generator" in roles and not qualified_local_generator(descriptor):
            roles = tuple(role for role in roles if role != "generator")
        if not roles:
            continue
        agent_type = descriptor.get("agent_type")
        if invocation == "subagent" and "planner" in roles:
            if agent_type != "planner-proposal":
                raise ToolCatalogError(
                    f"subagent Planner {agent_id!r} must use agent_type='planner-proposal'"
                )
            if set(roles) != {"planner"}:
                raise ToolCatalogError(
                    f"subagent Planner {agent_id!r} must not share its persona with "
                    "other roles"
                )
        if invocation == "subagent" and agent_type is not None:
            agent_type = nonempty_string(agent_type, f"agent {agent_id!r}.agent_type")
        if invocation == "local-cli":
            valid_sandbox(descriptor.get("sandbox"), f"agent {agent_id!r}.sandbox", require_home=False)
        family = bounded_text(descriptor.get("model_family"), f"agent {agent_id!r}.model_family", 128)
        canonical, tool_label, adapter_contract = legacy_canonical_tool(descriptor, adapters_dir)
        target_timeout = timeout_s(descriptor.get("timeout_s"), f"agent {agent_id!r}.timeout_s")
        raw_capabilities = capabilities(descriptor.get("capabilities"), f"agent {agent_id!r}.capabilities")
        candidates.append(
            Candidate(
                target_id=agent_id,
                integration_id=agent_id,
                roles=roles,
                tool=canonical,
                invocation=invocation,
                model_family=family,
                priority=priority(descriptor.get("priority"), f"agent {agent_id!r}.priority"),
                capabilities=raw_capabilities,
                label=tool_label,
                adapter=descriptor.get("adapter") if invocation == "local-cli" else None,
                sandbox=descriptor.get("sandbox") if invocation == "local-cli" else None,
                timeout_s=target_timeout,
                endpoint=endpoint_value,
                auth=auth,
                agent_type=agent_type if invocation == "subagent" else None,
                # Preserve the Coordinator route explicitly in the internal
                # target record.  Planner/Generator wrappers already treat
                # this as host-native; making it explicit keeps dispatch-run
                # and provenance semantics aligned with those wrappers.
                bridge_id="host-native" if invocation == "subagent" else None,
                adapter_execution_contract_sha256=adapter_contract,
                v2_selectable=invocation != "subagent",
            )
        )
    return candidates


@dataclass(frozen=True)
class Integration:
    id: str
    tool: str
    label: str
    model_family: str
    priority: int
    capabilities: tuple[str, ...]
    local_cli: dict[str, Any] | None
    subagent: SubagentBridge | None


def integration_candidates(
    registry: dict[str, Any], adapters_dir: Path, bridges_dir: Path
) -> list[Candidate]:
    allowed_root = {"_comment", "version", "integrations", "a2a_targets"}
    exact_fields(registry, allowed_root, "tool integrations registry")
    if registry.get("version") != INTEGRATION_REGISTRY_VERSION:
        raise ToolCatalogError(f"unsupported registry version: {registry.get('version')!r}")
    if registry.get("_comment") is not None and not isinstance(registry.get("_comment"), str):
        raise ToolCatalogError("tool integrations registry._comment must be a string")
    raw_integrations = registry.get("integrations")
    raw_targets = registry.get("a2a_targets")
    if not isinstance(raw_integrations, list) or not raw_integrations:
        raise ToolCatalogError("tool integrations registry.integrations must be a non-empty array")
    if not isinstance(raw_targets, list):
        raise ToolCatalogError("tool integrations registry.a2a_targets must be an array")

    integrations: dict[str, Integration] = {}
    candidates: list[Candidate] = []
    pending_external_bridges: list[Integration] = []
    for index, raw in enumerate(raw_integrations):
        label = f"integrations[{index}]"
        value = exact_fields(raw, INTEGRATION_FIELDS, label)
        integration_id = tool_id(value.get("id"), f"{label}.id")
        if integration_id in integrations:
            raise ToolCatalogError(f"integration id is duplicated: {integration_id!r}")
        canonical_tool = tool_id(value.get("tool"), f"{label}.tool")
        family = bounded_text(value.get("model_family"), f"{label}.model_family", 128)
        display = value.get("label", canonical_tool)
        display = bounded_text(display, f"{label}.label", 128)
        if value.get("notes") is not None and not isinstance(value.get("notes"), str):
            raise ToolCatalogError(f"{label}.notes must be a string")
        raw_subagent = value.get("subagent")
        if raw_subagent is True:
            # This legacy bit describes the fixed Coordinator's own native
            # child capability, not a selectable external CLI transport.  A
            # tool-labelled catalog candidate here would let a project claim
            # (for example) "Codex subagent" while the Coordinator actually
            # launches its own child. Keep the declaration schema-compatible
            # for fast/default and legacy descriptor flows, but publish no
            # signable v2 target. External CLI subagents require a verified
            # bridge manifest below.
            subagent = None
        elif raw_subagent is None:
            subagent = None
        else:
            declaration = exact_fields(raw_subagent, {"bridge"}, f"{label}.subagent")
            if "bridge" not in declaration:
                raise ToolCatalogError(f"{label}.subagent.bridge is required")
            bridge_id = tool_id(declaration.get("bridge"), f"{label}.subagent.bridge")
            subagent = load_subagent_bridge(bridges_dir, bridge_id)
        integration = Integration(
            id=integration_id,
            tool=canonical_tool,
            label=display,
            model_family=family,
            priority=priority(value.get("priority"), f"{label}.priority"),
            capabilities=capabilities(value.get("capabilities"), f"{label}.capabilities"),
            local_cli=None,
            subagent=subagent,
        )

        if "local_cli" in value:
            raw_local = value["local_cli"]
            local = exact_fields(raw_local, LOCAL_CLI_FIELDS, f"{label}.local_cli")
            if "adapter" not in local or "sandbox" not in local:
                raise ToolCatalogError(f"{label}.local_cli requires adapter and sandbox")
            adapter_name = tool_id(local.get("adapter"), f"{label}.local_cli.adapter")
            sandbox = valid_sandbox(local.get("sandbox"), f"{label}.local_cli.sandbox", require_home=True)
            assert sandbox is not None
            local_timeout = timeout_s(local.get("timeout_s"), f"{label}.local_cli.timeout_s")
            canonical, adapter_label, adapter_contract = load_adapter(
                adapters_dir,
                adapter_name,
                configured_tool=canonical_tool,
                model_family=family,
                owner_label=f"integration {integration_id!r}",
            )
            integration = Integration(
                **{**integration.__dict__, "local_cli": {
                    "adapter": adapter_name,
                    "sandbox": sandbox,
                    "timeout_s": local_timeout,
                    "adapter_label": adapter_label,
                    "canonical_tool": canonical,
                    "adapter_execution_contract_sha256": adapter_contract,
                }}
            )
        # Validate the declared bridge before considering host availability.
        # Otherwise a malformed manifest could masquerade as a harmless
        # unsupported-host downgrade.
        if integration.subagent is not None and integration.subagent.requires_local_cli:
            if integration.local_cli is None:
                raise ToolCatalogError(
                    f"{label}.subagent bridge {integration.subagent.id!r} requires local_cli "
                    "for its verified sandbox, credentials, and timeout policy"
                )
            validate_bridge_adapter_command(
                adapters_dir,
                integration.local_cli["adapter"],
                integration.subagent,
            )
        integrations[integration_id] = integration

        if integration.local_cli is not None:
            local = integration.local_cli
            for role in ROLES:
                candidates.append(
                    Candidate(
                        target_id=generated_target_id("local-cli", integration_id, role),
                        integration_id=integration_id,
                        roles=(role,),
                        tool=local["canonical_tool"],
                        invocation="local-cli",
                        model_family=family,
                        priority=integration.priority,
                        capabilities=integration.capabilities,
                        label=integration.label or local["adapter_label"],
                        adapter=local["adapter"],
                        sandbox=local["sandbox"],
                        timeout_s=local["timeout_s"],
                        adapter_execution_contract_sha256=local[
                            "adapter_execution_contract_sha256"
                        ],
                    )
                )
        if integration.subagent is not None:
            pending_external_bridges.append(integration)

    # A manifest proves only that the released driver understands the CLI wire
    # protocol.  It cannot make a hostile same-UID external process safe.  Do
    # not disclose a subagent choice until every declaration has validated and
    # a framework-owned strict provider freshly attests the current host.
    provider = resolved_external_same_session_bridge_provider()
    if provider is not None:
        for integration in pending_external_bridges:
            bridge = integration.subagent
            assert bridge is not None
            if not provider.supports(integration.tool, bridge.protocol):
                continue
            bridge_local = integration.local_cli if bridge.requires_local_cli else None
            for role, agent_type in bridge.personas.items():
                candidates.append(
                    Candidate(
                        target_id=generated_target_id("subagent", integration.id, role),
                        integration_id=integration.id,
                        roles=(role,),
                        tool=integration.tool,
                        invocation="subagent",
                        model_family=integration.model_family,
                        priority=integration.priority,
                        capabilities=integration.capabilities,
                        label=integration.label,
                        adapter=bridge_local["adapter"] if bridge_local is not None else None,
                        sandbox=bridge_local["sandbox"] if bridge_local is not None else None,
                        timeout_s=external_bridge_timeout(
                            bridge_local["timeout_s"] if bridge_local is not None else None,
                            provider,
                        ),
                        agent_type=agent_type,
                        native_agent_type=bridge.native_agent_types[role],
                        deliverable_channel=bridge.deliverable_channels[role],
                        bridge_id=bridge.id,
                        bridge_strategy=bridge.strategy,
                        session_scope=bridge.session_scope,
                        bridge_protocol=bridge.protocol or None,
                        bridge_provider_id=provider.id,
                        bridge_provider_kind=provider.kind,
                        bridge_provider_contract_sha256=provider.contract_sha256,
                        adapter_execution_contract_sha256=(
                            bridge_local["adapter_execution_contract_sha256"]
                            if bridge_local is not None else None
                        ),
                        bridge_semantics=subagent_bridge_semantics(bridge),
                    )
                )

    seen_targets: set[str] = set()
    for index, raw in enumerate(raw_targets):
        label = f"a2a_targets[{index}]"
        value = exact_fields(raw, A2A_TARGET_FIELDS, label)
        target_id = tool_id(value.get("id"), f"{label}.id")
        if target_id in seen_targets:
            raise ToolCatalogError(f"a2a target id is duplicated: {target_id!r}")
        seen_targets.add(target_id)
        integration_id = tool_id(value.get("integration_id"), f"{label}.integration_id")
        integration = integrations.get(integration_id)
        if integration is None:
            raise ToolCatalogError(
                f"{label}.integration_id={integration_id!r} does not name an integration"
            )
        if integration.local_cli is None:
            raise ToolCatalogError(
                f"{label}.integration_id={integration_id!r} must provide local_cli; "
                "the harness A2A runner executes a verified local-cli integration"
            )
        target_endpoint = endpoint(value.get("endpoint"), f"{label}.endpoint")
        remote_runner_id = stable_agent_id(
            value.get("remote_runner_id"), f"{label}.remote_runner_id"
        )
        try:
            auth = a2a_auth_config(value.get("auth", A2A_AUTH_UNSET), f"{label}.auth")
        except DispatchContractError as exc:
            raise ToolCatalogError(str(exc)) from exc
        if value.get("notes") is not None and not isinstance(value.get("notes"), str):
            raise ToolCatalogError(f"{label}.notes must be a string")
        target_capabilities = tuple(sorted(set(integration.capabilities) | set(capabilities(value.get("capabilities"), f"{label}.capabilities"))))
        target_priority = priority(value.get("priority"), f"{label}.priority", default=integration.priority)
        for role in NON_GENERATOR_ROLES:
            candidates.append(
                Candidate(
                    target_id=generated_target_id("a2a", target_id, role),
                    integration_id=integration_id,
                    roles=(role,),
                    tool=integration.tool,
                    invocation="a2a",
                    model_family=integration.model_family,
                    priority=target_priority,
                    capabilities=target_capabilities,
                    label=integration.label,
                    endpoint=target_endpoint,
                    auth=auth,
                    remote_runner_id=remote_runner_id,
                    # A direct A2A client can only use the catalog target
                    # returned with a verified provenance digest.  Keep the
                    # transport deadline in that immutable target snapshot
                    # too, rather than asking the client to reopen registry
                    # integration.local_cli after verification.
                    timeout_s=integration.local_cli["timeout_s"],
                    adapter_execution_contract_sha256=integration.local_cli[
                        "adapter_execution_contract_sha256"
                    ],
                )
            )
    return candidates


def candidates_from_registry(
    registry_path: Path, adapters_dir: Path, bridges_dir: Path
) -> list[Candidate]:
    registry = load_json(registry_path, "agent registry")
    if not isinstance(registry, dict):
        raise ToolCatalogError("agent registry must be an object")
    version = registry.get("version")
    if version == LEGACY_REGISTRY_VERSION:
        return legacy_candidates(registry, adapters_dir)
    if version == INTEGRATION_REGISTRY_VERSION:
        return integration_candidates(registry, adapters_dir, bridges_dir)
    raise ToolCatalogError(
        f"unsupported registry version {version!r}; expected {LEGACY_REGISTRY_VERSION!r} "
        f"or {INTEGRATION_REGISTRY_VERSION!r}"
    )


def build_catalog(candidates: list[Candidate]) -> dict[str, Any]:
    roles: dict[str, list[dict[str, Any]]] = {}
    for role in ROLES:
        grouped: dict[tuple[str, str], list[Candidate]] = {}
        for candidate in candidates:
            if candidate.v2_selectable and role in candidate.roles:
                grouped.setdefault((candidate.tool, candidate.invocation), []).append(candidate)
        entries: list[dict[str, Any]] = []
        for (tool, invocation), pool in grouped.items():
            labels = {candidate.label for candidate in pool}
            if len(labels) != 1:
                raise ToolCatalogError(
                    f"tool {tool!r} has inconsistent labels in {role}/{invocation} candidates"
                )
            entries.append(
                {
                    "tool": tool,
                    "label": next(iter(labels)),
                    "invocation": invocation,
                    "agent_count": len(pool),
                    "model_families": sorted({candidate.model_family for candidate in pool}),
                    "capabilities": sorted(
                        {capability for candidate in pool for capability in candidate.capabilities}
                    ),
                }
            )
        roles[role] = sorted(entries, key=lambda item: (item["tool"], item["invocation"]))
    return {"version": "tool-catalog/1", "roles": roles}


# Keep this alias runtime-neutral for the Python 3.9 baseline used by some
# installed harnesses. PEP 604's ``dict[...] | None`` is not a valid alias
# expression there even with postponed annotation evaluation.
Binding = Any


def load_bindings(path: Path) -> dict[str, Binding]:
    raw = load_json(path, "role bindings")
    if not isinstance(raw, dict):
        raise ToolCatalogError("role bindings must be an object")
    unknown = sorted(set(raw) - set(ROLES))
    missing = sorted(set(ROLES) - set(raw))
    if unknown or missing:
        raise ToolCatalogError(f"role bindings must contain exactly {list(ROLES)}; missing={missing}, extra={unknown}")

    bindings: dict[str, Binding] = {}
    for role in ROLES:
        value = raw[role]
        if role == "planner" and value is None:
            bindings[role] = None
            continue
        if not isinstance(value, dict):
            raise ToolCatalogError(f"binding {role!r} must be an object")
        unknown_fields = sorted(set(value) - {"tool", "invocation"})
        missing_fields = sorted({"tool", "invocation"} - set(value))
        if unknown_fields or missing_fields:
            raise ToolCatalogError(
                f"binding {role!r} must contain exactly tool and invocation; "
                f"missing={missing_fields}, extra={unknown_fields}"
            )
        invocation = nonempty_string(value["invocation"], f"binding {role!r}.invocation")
        if invocation not in INVOCATIONS:
            raise ToolCatalogError(f"binding {role!r}.invocation is unsupported: {invocation!r}")
        bindings[role] = {
            "tool": tool_id(value["tool"], f"binding {role!r}.tool"),
            "invocation": invocation,
        }
    return bindings


def candidates_for(candidates: list[Candidate], role: str, binding: Binding) -> list[Candidate]:
    if binding is None:
        return []
    return sorted(
        (
            candidate
            for candidate in candidates
            if candidate.v2_selectable
            and role in candidate.roles
            and candidate.tool == binding["tool"]
            and candidate.invocation == binding["invocation"]
        ),
        key=lambda candidate: (candidate.priority, candidate.target_id),
    )


def resolve(candidates: list[Candidate], bindings: dict[str, Binding]) -> dict[str, dict[str, Any] | None]:
    pools = {
        role: candidates_for(candidates, role, bindings[role])
        for role in ("generator", "evaluator")
    }
    empty = [role for role, pool in pools.items() if not pool]
    if empty:
        details = ", ".join(
            f"{role}={bindings[role]['tool']}+{bindings[role]['invocation']}" for role in empty
        )
        raise ToolCatalogError(f"no eligible agent for binding(s): {details}")

    planner: Candidate | None = None
    if bindings["planner"] is not None:
        planner_pool = candidates_for(candidates, "planner", bindings["planner"])
        if not planner_pool:
            binding = bindings["planner"]
            assert binding is not None
            raise ToolCatalogError(
                "no eligible agent for binding(s): "
                f"planner={binding['tool']}+{binding['invocation']}"
            )
        planner = planner_pool[0]

    selected_generator: Candidate | None = None
    selected_evaluator: Candidate | None = None
    # Preserve deterministic preference: take the first generator that has a
    # differently-family evaluator, then the first such evaluator. This is
    # stable under fixed priorities and target ids.
    for generator in pools["generator"]:
        evaluator = next(
            (
                candidate
                for candidate in pools["evaluator"]
                if candidate.model_family != generator.model_family
            ),
            None,
        )
        if evaluator is not None:
            selected_generator = generator
            selected_evaluator = evaluator
            break
    if selected_generator is None or selected_evaluator is None:
        raise ToolCatalogError(
            "generator and evaluator bindings have no pair with different model_family"
        )

    return {
        "planner": planner.public() if planner is not None else None,
        "generator": selected_generator.public(),
        "evaluator": selected_evaluator.public(),
    }


def resolve_target(candidates: list[Candidate], target_id: str) -> dict[str, Any]:
    target_id = stable_agent_id(target_id, "target id")
    matches = [candidate for candidate in candidates if candidate.target_id == target_id]
    if not matches:
        raise ToolCatalogError(f"target id is not registered: {target_id!r}")
    first = matches[0].target_public()
    if any(candidate.target_public() != first for candidate in matches[1:]):
        raise ToolCatalogError(f"target id resolves ambiguously: {target_id!r}")
    return first


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    for name in ("catalog", "resolve", "target"):
        command = sub.add_parser(name)
        command.add_argument("--registry", required=True, type=Path)
        command.add_argument("--adapters", type=Path, default=default_adapters_dir())
        command.add_argument("--bridges", type=Path, default=default_bridges_dir())
        if name == "resolve":
            command.add_argument("--bindings", required=True, type=Path)
        if name == "target":
            command.add_argument("--target-id", required=True)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        candidates = candidates_from_registry(args.registry, args.adapters, args.bridges)
        if args.command == "catalog":
            output: dict[str, Any] = build_catalog(candidates)
        elif args.command == "resolve":
            output = resolve(candidates, load_bindings(args.bindings))
        else:
            output = resolve_target(candidates, args.target_id)
    except ToolCatalogError as exc:
        print(f"[tool-catalog] error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
