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
import json
import re
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
TOOL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SAFE_CAPABILITY = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
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


def endpoint(value: Any, label: str) -> str:
    return bounded_text(value, label, 2_048)


def default_adapters_dir() -> Path:
    return Path(__file__).resolve().parent / "transports" / "adapters"


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

    def public(self) -> dict[str, Any]:
        return {
            "agent_id": self.target_id,
            "tool": self.tool,
            "invocation": self.invocation,
            "model_family": self.model_family,
            "priority": self.priority,
        }

    def target_public(self) -> dict[str, Any]:
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
        if self.capabilities:
            value["capabilities"] = list(self.capabilities)
        return value


def adapter_path(adapters_dir: Path, name: str) -> Path:
    # Do not turn registry-controlled strings into a path traversal primitive.
    if not TOOL_ID.fullmatch(name):
        raise ToolCatalogError(f"adapter name {name!r} is not a safe adapter id")
    return adapters_dir / f"{name}.json"


def load_adapter(
    adapters_dir: Path,
    adapter_name: str,
    *,
    configured_tool: str | None,
    model_family: str,
    owner_label: str,
) -> tuple[str, str]:
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
    if adapter.get("envelope_delivery") not in ENVELOPE_DELIVERIES:
        raise ToolCatalogError(
            f"adapter {adapter_name!r}.envelope_delivery must be one of "
            f"{ENVELOPE_DELIVERIES!r}"
        )
    if adapter.get("_verified") is not True:
        raise ToolCatalogError(
            f"adapter {adapter_name!r} is not verified; local-cli tools cannot enter the catalog"
        )
    try:
        external_environment_allowlist(
            adapter.get("env_allowlist_extra"),
            f"adapter {adapter_name!r}.env_allowlist_extra",
        )
    except DispatchContractError as exc:
        raise ToolCatalogError(str(exc)) from exc

    canonical = configured_tool if configured_tool is not None else adapter_tool
    label = adapter.get("display_name", canonical)
    return canonical, bounded_text(label, f"adapter {adapter_name!r}.display_name", 128)


def legacy_canonical_tool(descriptor: dict[str, Any], adapters_dir: Path) -> tuple[str, str]:
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
        return value, value
    if invocation == "subagent":
        return "claude-code", "claude-code"
    return tool_id(family, f"agent {descriptor_id!r}.model_family"), family


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
        canonical, tool_label = legacy_canonical_tool(descriptor, adapters_dir)
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
    subagent: bool


def integration_candidates(registry: dict[str, Any], adapters_dir: Path) -> list[Candidate]:
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
        if "subagent" in value and value["subagent"] is not True:
            raise ToolCatalogError(f"{label}.subagent must be true when declared")
        integration = Integration(
            id=integration_id,
            tool=canonical_tool,
            label=display,
            model_family=family,
            priority=priority(value.get("priority"), f"{label}.priority"),
            capabilities=capabilities(value.get("capabilities"), f"{label}.capabilities"),
            local_cli=None,
            subagent=value.get("subagent", False) is True,
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
            canonical, adapter_label = load_adapter(
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
                }}
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
                    )
                )
        if integration.subagent:
            for role in ROLES:
                candidates.append(
                    Candidate(
                        target_id=generated_target_id("subagent", integration_id, role),
                        integration_id=integration_id,
                        roles=(role,),
                        tool=canonical_tool,
                        invocation="subagent",
                        model_family=family,
                        priority=integration.priority,
                        capabilities=integration.capabilities,
                        label=integration.label,
                        agent_type=SUBAGENT_PERSONAS[role],
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
                )
            )
    return candidates


def candidates_from_registry(registry_path: Path, adapters_dir: Path) -> list[Candidate]:
    registry = load_json(registry_path, "agent registry")
    if not isinstance(registry, dict):
        raise ToolCatalogError("agent registry must be an object")
    version = registry.get("version")
    if version == LEGACY_REGISTRY_VERSION:
        return legacy_candidates(registry, adapters_dir)
    if version == INTEGRATION_REGISTRY_VERSION:
        return integration_candidates(registry, adapters_dir)
    raise ToolCatalogError(
        f"unsupported registry version {version!r}; expected {LEGACY_REGISTRY_VERSION!r} "
        f"or {INTEGRATION_REGISTRY_VERSION!r}"
    )


def build_catalog(candidates: list[Candidate]) -> dict[str, Any]:
    roles: dict[str, list[dict[str, Any]]] = {}
    for role in ROLES:
        grouped: dict[tuple[str, str], list[Candidate]] = {}
        for candidate in candidates:
            if role in candidate.roles:
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
            if role in candidate.roles
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
        if name == "resolve":
            command.add_argument("--bindings", required=True, type=Path)
        if name == "target":
            command.add_argument("--target-id", required=True)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        candidates = candidates_from_registry(args.registry, args.adapters)
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
