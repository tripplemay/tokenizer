#!/usr/bin/env python3
"""Evaluator probe: is the Kimi ACP bridge publishable, or permanently dormant?

The previous verdict recorded F003's bridge as unusable ("dormant"). This probe
separates the two possible causes:

  (a) the route is structurally disabled  -> genuine FAIL
  (b) the route is gated on a live input  -> designed fail-closed

It builds a REAL strict-provider catalog attestation from the installed
provider configuration (real contract/image/CLI-bundle/broker digests and a
real ``_assert_vm_ready`` check), stubbing only ``_read_broker_credential``,
which is the single environmental input that is currently expired on this
host. The attestation is then fed through tool-catalog's own unmodified
parsing and validation path.

No product code is modified and no real Kimi API call is made.

Run: python3 scripts/test/f003_bridge_publication_probe.py
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
DISPATCH = REPO / ".claude" / "dispatch"
sys.path.insert(0, str(DISPATCH))


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    provider = load("vmprov", DISPATCH / "transports" / "vm-bridge-provider.py")
    catalog = load("toolcatalog", DISPATCH / "tool-catalog.py")

    print("== 1. live provider state (no stubs) ==")
    live = subprocess.run(
        ["/usr/bin/python3", "-I",
         str(DISPATCH / "transports" / "vm-bridge-provider.py"), "doctor"],
        stdout=subprocess.PIPE, text=True, check=False,
    )
    print("   doctor:", live.stdout.strip())

    cfg = provider.load_provider_configuration()
    checks = {}
    for name, fn in (
        ("cli_bundle_protocols", lambda: provider._bundle_protocol_commands(cfg.cli_bundle)),
        ("vm_ready", lambda: provider._assert_vm_ready(cfg)),
        ("broker_policy", lambda: provider._broker_policy(cfg).guest_broker_host),
    ):
        try:
            checks[name] = ("OK", fn())
        except Exception as exc:  # noqa: BLE001
            checks[name] = ("FAILED", f"{type(exc).__name__}: {exc}")
    for name, (status, detail) in checks.items():
        print(f"   {name}: {status} {detail if status == 'OK' else detail}")

    print("\n== 2. attestation with only the expired credential stubbed ==")
    with mock.patch.object(provider, "_read_broker_credential",
                           return_value="probe-token-not-a-real-credential"):
        attested = provider.catalog_attestation()
    raw = json.dumps(attested)
    assert "probe-token" not in raw, "attestation leaked the credential"
    print("   available:", attested["available"])
    print("   provider:", attested["provider"]["id"], attested["provider"]["kind"])
    print("   phase:", attested["attestation"]["phase"],
          "| ttl:", attested["attestation"]["issued_at"],
          "->", attested["attestation"]["expires_at"])
    print("   credential never appears in attestation: OK")

    print("\n== 3. tool-catalog's own parser consumes that attestation ==")
    completed = subprocess.CompletedProcess(args=[], returncode=0, stdout=raw, stderr="")
    with mock.patch.object(catalog.subprocess, "run", return_value=completed):
        resolved = catalog.external_same_session_bridge_provider()
    print("   parsed provider:", resolved)
    if resolved is None:
        print("   -> catalog REJECTED a real attestation")
        return 1

    print("\n== 4. catalog + target against the real project registry ==")
    registry = REPO / ".agents-registry.json"
    adapters = DISPATCH / "transports" / "adapters"
    bridges = DISPATCH / "transports" / "bridges"
    with mock.patch.object(catalog, "external_same_session_bridge_provider",
                           return_value=resolved):
        candidates = catalog.candidates_from_registry(registry, adapters, bridges)
        built = catalog.build_catalog(candidates)
        published = {
            role: sorted(
                (e["tool"], e["invocation"])
                for e in built["roles"][role]
                if e["invocation"] == "subagent"
            )
            for role in ("planner", "generator", "evaluator")
        }
        for role, entries in published.items():
            print(f"   {role}: subagent candidates = {entries}")
        targets = {}
        for role in ("planner", "generator", "evaluator"):
            target_id = f"subagent--kimi--{role}"
            try:
                targets[role] = catalog.resolve_target(candidates, target_id)
            except Exception as exc:  # noqa: BLE001
                targets[role] = {"error": f"{type(exc).__name__}: {exc}"}

    ok = all(("kimi", "subagent") in published[r]
             for r in ("planner", "generator", "evaluator"))
    print(f"\n   three-role kimi subagent publication: {'OK' if ok else 'MISSING'}")

    print("\n== 5. resolved target provenance ==")
    for role, target in targets.items():
        if "error" in target:
            print(f"   {role}: {target['error']}")
            continue
        print(f"   {role}: bridge_id={target.get('bridge_id')} "
              f"strategy={target.get('bridge_strategy')} "
              f"provider={target.get('bridge_provider_id')}/{target.get('bridge_provider_kind')} "
              f"native_type={target.get('native_agent_type')} "
              f"persona={target.get('bridge_persona')}")
        print(f"        execution_provenance_sha256="
              f"{str(target.get('execution_provenance_sha256'))[:24]}...")
        print(f"        provider_contract_sha256="
              f"{str(target.get('bridge_provider_contract_sha256'))[:24]}...")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
