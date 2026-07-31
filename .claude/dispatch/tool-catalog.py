#!/usr/bin/env python3
"""Build a registry-driven tool catalog and resolve role bindings.

The console signs a stable tool/invocation pair, never a concrete agent id. This
helper is deliberately local and stdlib-only: it turns the project registry and
adapter manifests into the capability snapshot exposed to the console, then
resolves a binding at the next batch boundary.

Compatibility fallback for pre-catalog descriptors:
  * explicit descriptor tool, then local-cli adapter.tool / adapter.name
  * subagent: claude-code
  * other transports: model_family

Examples:
  tool-catalog.py catalog --registry .agents-registry.json
  tool-catalog.py resolve --registry .agents-registry.json --bindings bindings.json
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
    external_environment_allowlist,
    external_environment_set,
)


ROLES = ("planner", "generator", "evaluator")
INVOCATIONS = ("subagent", "local-cli", "a2a")
ENVELOPE_DELIVERIES = ("stdin", "argv", "env")
TOOL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


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


def priority(value: Any, label: str) -> int:
    if value is None:
        return 1000
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ToolCatalogError(f"{label} must be a non-negative integer")
    return value


def default_adapters_dir() -> Path:
    return Path(__file__).resolve().parent / "transports" / "adapters"


@dataclass(frozen=True)
class Candidate:
    agent_id: str
    roles: tuple[str, ...]
    tool: str
    invocation: str
    model_family: str
    priority: int
    capabilities: tuple[str, ...]
    label: str

    def public(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "tool": self.tool,
            "invocation": self.invocation,
            "model_family": self.model_family,
            "priority": self.priority,
        }


def adapter_path(adapters_dir: Path, name: str) -> Path:
    # Do not turn a registry-controlled string into a path traversal primitive.
    if not TOOL_ID.fullmatch(name):
        raise ToolCatalogError(f"adapter name {name!r} is not a safe adapter id")
    return adapters_dir / f"{name}.json"


def load_adapter(adapters_dir: Path, adapter_name: str, descriptor: dict[str, Any]) -> tuple[str, str]:
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
    descriptor_tool = descriptor.get("tool")
    if (
        adapter_declares_tool
        and descriptor_tool is not None
        and tool_id(descriptor_tool, "agent.tool") != adapter_tool
    ):
        raise ToolCatalogError(
            f"agent {descriptor.get('id')!r} tool={descriptor_tool!r} disagrees with "
            f"adapter {adapter_name!r} tool={adapter_tool!r}"
        )

    adapter_family = nonempty_string(
        adapter.get("model_family"), f"adapter {adapter_name!r}.model_family"
    )
    descriptor_family = nonempty_string(
        descriptor.get("model_family"), f"agent {descriptor.get('id')!r}.model_family"
    )
    if adapter_family != descriptor_family:
        raise ToolCatalogError(
            f"agent {descriptor.get('id')!r} model_family={descriptor_family!r} disagrees "
            f"with adapter {adapter_name!r} model_family={adapter_family!r}"
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

    canonical = tool_id(descriptor_tool, "agent.tool") if descriptor_tool is not None else adapter_tool
    label = adapter.get("display_name", canonical)
    return canonical, nonempty_string(label, f"adapter {adapter_name!r}.display_name")


def canonical_tool(descriptor: dict[str, Any], adapters_dir: Path) -> tuple[str, str]:
    invocation = descriptor.get("transport")
    if invocation == "local-cli":
        adapter_name = tool_id(descriptor.get("adapter"), f"agent {descriptor.get('id')!r}.adapter")
        return load_adapter(adapters_dir, adapter_name, descriptor)

    raw_tool = descriptor.get("tool")
    if raw_tool is not None:
        value = tool_id(raw_tool, f"agent {descriptor.get('id')!r}.tool")
        return value, value
    if invocation == "subagent":
        return "claude-code", "claude-code"
    return tool_id(descriptor.get("model_family"), f"agent {descriptor.get('id')!r}.model_family"), nonempty_string(
        descriptor.get("model_family"), f"agent {descriptor.get('id')!r}.model_family"
    )


def qualified_local_generator(descriptor: dict[str, Any]) -> bool:
    """A returnable external Generator must use the fixed sandbox-diff protocol."""
    constraints = descriptor.get("constraints")
    return (
        isinstance(constraints, dict)
        and constraints.get("write_src") is True
        and constraints.get("push") is False
        and constraints.get("l2") is False
    )


def candidates_from_registry(registry_path: Path, adapters_dir: Path) -> list[Candidate]:
    registry = load_json(registry_path, "agent registry")
    if not isinstance(registry, dict):
        raise ToolCatalogError("agent registry must be an object")
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
        if invocation == "a2a":
            try:
                a2a_auth_config(
                    descriptor.get("auth", A2A_AUTH_UNSET),
                    f"agent {agent_id!r}.auth",
                )
            except DispatchContractError as exc:
                raise ToolCatalogError(str(exc)) from exc
        elif "auth" in descriptor:
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
        if invocation == "subagent" and "planner" in roles:
            if descriptor.get("agent_type") != "planner-proposal":
                raise ToolCatalogError(
                    f"subagent Planner {agent_id!r} must use agent_type='planner-proposal'"
                )
            if set(roles) != {"planner"}:
                raise ToolCatalogError(
                    f"subagent Planner {agent_id!r} must not share its persona with "
                    "other roles"
                )
        if invocation == "local-cli":
            sandbox = descriptor.get("sandbox") or {}
            if not isinstance(sandbox, dict):
                raise ToolCatalogError(f"agent {agent_id!r}.sandbox must be an object")
            try:
                external_environment_allowlist(
                    sandbox.get("env_allow"), f"agent {agent_id!r}.sandbox.env_allow"
                )
                external_environment_set(
                    sandbox.get("env_set"), f"agent {agent_id!r}.sandbox.env_set"
                )
            except DispatchContractError as exc:
                raise ToolCatalogError(str(exc)) from exc
        family = nonempty_string(descriptor.get("model_family"), f"agent {agent_id!r}.model_family")
        canonical, tool_label = canonical_tool(descriptor, adapters_dir)

        raw_capabilities = descriptor.get("capabilities") or []
        if not isinstance(raw_capabilities, list) or any(
            not isinstance(item, str) or not item.strip() for item in raw_capabilities
        ):
            raise ToolCatalogError(f"agent {agent_id!r}.capabilities must be a string array")
        candidates.append(
            Candidate(
                agent_id=agent_id,
                roles=roles,
                tool=canonical,
                invocation=invocation,
                model_family=family,
                priority=priority(descriptor.get("priority"), f"agent {agent_id!r}.priority"),
                capabilities=tuple(sorted(set(raw_capabilities))),
                label=tool_label,
            )
        )
    return candidates


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


def load_bindings(path: Path) -> dict[str, dict[str, str]]:
    raw = load_json(path, "role bindings")
    if not isinstance(raw, dict):
        raise ToolCatalogError("role bindings must be an object")
    unknown = sorted(set(raw) - set(ROLES))
    missing = sorted(set(ROLES) - set(raw))
    if unknown or missing:
        raise ToolCatalogError(f"role bindings must contain exactly {list(ROLES)}; missing={missing}, extra={unknown}")

    bindings: dict[str, dict[str, str]] = {}
    for role in ROLES:
        value = raw[role]
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


def candidates_for(candidates: list[Candidate], role: str, binding: dict[str, str]) -> list[Candidate]:
    return sorted(
        (
            candidate
            for candidate in candidates
            if role in candidate.roles
            and candidate.tool == binding["tool"]
            and candidate.invocation == binding["invocation"]
        ),
        key=lambda candidate: (candidate.priority, candidate.agent_id),
    )


def resolve(candidates: list[Candidate], bindings: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    pools = {role: candidates_for(candidates, role, bindings[role]) for role in ROLES}
    empty = [role for role, pool in pools.items() if not pool]
    if empty:
        details = ", ".join(
            f"{role}={bindings[role]['tool']}+{bindings[role]['invocation']}" for role in empty
        )
        raise ToolCatalogError(f"no eligible agent for binding(s): {details}")

    planner = pools["planner"][0]
    selected_generator: Candidate | None = None
    selected_evaluator: Candidate | None = None
    # Preserve deterministic preference: take the first generator that has a
    # differently-family evaluator, then the first such evaluator. This is
    # stable under a registry with fixed priorities and ids.
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
        "planner": planner.public(),
        "generator": selected_generator.public(),
        "evaluator": selected_evaluator.public(),
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    for name in ("catalog", "resolve"):
        command = sub.add_parser(name)
        command.add_argument("--registry", required=True, type=Path)
        command.add_argument("--adapters", type=Path, default=default_adapters_dir())
        if name == "resolve":
            command.add_argument("--bindings", required=True, type=Path)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        candidates = candidates_from_registry(args.registry, args.adapters)
        if args.command == "catalog":
            output: dict[str, Any] = build_catalog(candidates)
        else:
            output = resolve(candidates, load_bindings(args.bindings))
    except ToolCatalogError as exc:
        print(f"[tool-catalog] error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
