#!/usr/bin/env python3
"""Bind returned transport metadata to a re-verified active target."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


class RouteValidationError(ValueError):
    """The returned metadata cannot belong to the active execution route."""


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RouteValidationError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def load_json_file(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, ValueError) as exc:
        raise RouteValidationError(f"cannot read {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise RouteValidationError(f"{label} must be an object")
    return value


def load_json_argument(raw: str, label: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except (TypeError, ValueError) as exc:
        raise RouteValidationError(f"{label} is invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise RouteValidationError(f"{label} must be an object")
    return value


def required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise RouteValidationError(f"{label} is invalid")
    return value


def classify_return_route(
    metadata: dict[str, Any], active_role: dict[str, Any], active_target: dict[str, Any]
) -> dict[str, str]:
    """Return the authoritative route, rejecting metadata-controlled downgrade."""
    transport = required_text(metadata.get("transport"), "run metadata transport")
    if not active_role and not active_target:
        return {"route": "legacy", "invocation": transport}
    if not active_role or not active_target:
        raise RouteValidationError("active role and active target must be supplied together")

    role_agent = required_text(active_role.get("agent_id"), "active role agent_id")
    role_invocation = required_text(active_role.get("invocation"), "active role invocation")
    target_agent = required_text(active_target.get("target_id"), "active target target_id")
    target_invocation = required_text(active_target.get("invocation"), "active target invocation")
    metadata_agent = required_text(metadata.get("agent_id"), "run metadata agent_id")
    if role_agent != target_agent or metadata_agent != target_agent:
        raise RouteValidationError("run metadata agent does not match the re-verified active target")
    if role_invocation != target_invocation:
        raise RouteValidationError("active role invocation does not match the re-verified active target")
    if transport != target_invocation:
        raise RouteValidationError(
            "run metadata transport does not match the re-verified active target"
        )

    if target_invocation == "local-cli":
        return {"route": "local-cli", "invocation": target_invocation}
    if target_invocation == "a2a":
        return {"route": "a2a", "invocation": target_invocation}
    if target_invocation != "subagent":
        raise RouteValidationError("active target invocation is unsupported")

    bridge_id = required_text(active_target.get("bridge_id"), "active subagent bridge_id")
    if bridge_id == "host-native":
        return {"route": "host-native-subagent", "invocation": target_invocation}
    if (
        not isinstance(active_target.get("bridge_strategy"), str)
        or not isinstance(active_target.get("bridge_protocol"), dict)
        or active_target.get("session_scope") != "same-session"
    ):
        raise RouteValidationError("active target is not a supported external bridge route")
    return {"route": "external-bridge-subagent", "invocation": target_invocation}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--run-meta", required=True, type=Path)
    result.add_argument("--active-role-json", default="{}")
    result.add_argument("--active-target-json", default="{}")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        route = classify_return_route(
            load_json_file(args.run_meta, "run metadata"),
            load_json_argument(args.active_role_json, "active role JSON"),
            load_json_argument(args.active_target_json, "active target JSON"),
        )
    except RouteValidationError as exc:
        print(f"[active-return-route] {exc}", file=sys.stderr)
        return 2
    print(json.dumps(route, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
