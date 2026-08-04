#!/usr/bin/env python3
"""F002 reverify probe: prove Codex's external-bridge exclusion is structural.

Evaluator-owned test artifact (BL-NATIVE-SUBAGENT-BRIDGES, reverify round 1).
It does NOT modify product code.

Why this exists
---------------
On the reverify host the strict ``vm-v1`` provider is currently *unavailable*
("Kimi OAuth credential expires too soon"), so the live catalog publishes no
``subagent`` candidate for ANY tool.  That alone cannot prove F002: the absence
of a Codex bridge could be an artifact of the global fail-closed gate rather
than of Codex's own declaration.

This probe removes that ambiguity by patching the framework provider hook to a
fully attested strict provider and rebuilding the catalog from the REAL project
registry.  Under those conditions an eligible integration *must* publish its
bridge.  Codex must still publish none.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
DISPATCH = REPO / ".claude" / "dispatch"
REGISTRY = REPO / ".agents-registry.json"

sys.path.insert(0, str(DISPATCH))
spec = importlib.util.spec_from_file_location("tool_catalog", DISPATCH / "tool-catalog.py")
assert spec and spec.loader
tool_catalog = importlib.util.module_from_spec(spec)
sys.modules["tool_catalog"] = tool_catalog
spec.loader.exec_module(tool_catalog)

BRIDGE_FIELDS = (
    "bridge_id",
    "bridge_strategy",
    "session_scope",
    "bridge_protocol",
    "bridge_provider_id",
    "bridge_provider_kind",
    "bridge_provider_contract_sha256",
    "bridge_semantics",
    "agent_type",
    "native_agent_type",
)

failures: list[str] = []
notes: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  PASS  {message}")
    else:
        failures.append(message)
        print(f"  FAIL  {message}")


def attested_provider():
    return tool_catalog.StrictExternalBridgeProvider(
        id="reverify-attested-provider",
        kind="vm-v1",
        contract_sha256="b" * 64,
    )


def candidates(*, attested: bool):
    ctx = (
        mock.patch.object(
            tool_catalog,
            "external_same_session_bridge_provider",
            return_value=attested_provider(),
        )
        if attested
        else mock.patch.object(
            tool_catalog, "external_same_session_bridge_provider", return_value=None
        )
    )
    with ctx:
        return tool_catalog.candidates_from_registry(
            REGISTRY, tool_catalog.default_adapters_dir(), tool_catalog.default_bridges_dir()
        )


def subagents(cands, tool):
    return [c for c in cands if c.invocation == "subagent" and c.tool == tool]


def main() -> int:
    print("== F002 structural exclusion probe ==")
    print(f"registry: {REGISTRY}")

    print("\n[1] Provider UNAVAILABLE (live host condition)")
    closed = candidates(attested=False)
    check(not subagents(closed, "codex"), "codex publishes 0 subagent candidates")
    check(not subagents(closed, "kimi"), "kimi publishes 0 subagent candidates (fail-closed)")

    print("\n[2] Provider ATTESTED (differential: publication IS possible)")
    open_ = candidates(attested=True)
    kimi_sub = subagents(open_, "kimi")
    codex_sub = subagents(open_, "codex")
    check(
        len(kimi_sub) == 3,
        f"kimi publishes 3 subagent candidates when attested (got {len(kimi_sub)}) "
        "-> the gate is genuinely open, so codex's absence is meaningful",
    )
    check(
        not codex_sub,
        "codex STILL publishes 0 subagent candidates under an attested provider",
    )
    check(
        not subagents(open_, "claude-code"),
        "legacy `subagent: true` (claude-code) is not promoted to a v2 external bridge",
    )

    print("\n[3] Codex local-cli candidates keep verified execution contract")
    codex_local = [c for c in open_ if c.tool == "codex" and c.invocation == "local-cli"]
    check(len(codex_local) == 3, f"codex has 3 local-cli candidates (got {len(codex_local)})")
    for c in codex_local:
        role = c.roles[0]
        check(c.adapter == "codex", f"[{role}] adapter=codex")
        check(bool(c.adapter_execution_contract_sha256), f"[{role}] adapter contract sha present")
        check(c.timeout_s == 2400, f"[{role}] timeout_s=2400")
        sb = c.sandbox or {}
        check(
            sb.get("home_dir") == "~/.harness-sandbox/codex",
            f"[{role}] dedicated sandbox home_dir",
        )
        check(
            sb.get("env_set", {}).get("CODEX_HOME") == "~/.codex",
            f"[{role}] CODEX_HOME credential pinning",
        )
        check(sb.get("env_allow") == [], f"[{role}] env_allow empty (no host env passthrough)")
        leaked = [f for f in BRIDGE_FIELDS if getattr(c, f, None) not in (None, {}, ())]
        check(not leaked, f"[{role}] no bridge provenance fields (leaked={leaked})")

    print("\n[4] No Codex bridge manifest exists on disk")
    manifests = sorted(p.name for p in tool_catalog.default_bridges_dir().glob("*.json"))
    notes.append(f"bridge manifests: {manifests}")
    check(
        not any("codex" in m for m in manifests),
        f"no codex bridge manifest (found {manifests})",
    )

    print("\n== summary ==")
    for n in notes:
        print(f"  note: {n}")
    if failures:
        print(f"  RESULT: FAIL ({len(failures)} checks failed)")
        for f in failures:
            print(f"    - {f}")
        return 1
    print("  RESULT: PASS (all checks green)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
