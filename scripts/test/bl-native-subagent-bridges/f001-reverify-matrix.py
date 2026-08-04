#!/usr/bin/env python3
"""F001 reverify matrix (Evaluator-owned test artifact).

Exercises the declarative subagent-bridge registration and capability catalog
acceptance of BL-NATIVE-SUBAGENT-BRIDGES F001 against the real framework
implementation. It never imports product code as a library and never mutates
the repository: every negative/positive case is built in a private temp tree
and passed through the documented ``--adapters`` / ``--bridges`` flags.

Usage: python3 scripts/test/bl-native-subagent-bridges/f001-reverify-matrix.py
Writes a JSON evidence blob to stdout (and to --out when given).
"""
from __future__ import annotations

import argparse
import copy
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CATALOG = REPO / "framework" / "templates" / "claude" / "dispatch" / "tool-catalog.py"
TRANSPORTS = CATALOG.parent / "transports"
ADAPTERS = TRANSPORTS / "adapters"
BRIDGES = TRANSPORTS / "bridges"
PROJECT_REGISTRY = REPO / ".agents-registry.json"

RESULTS: list[dict] = []


def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CATALOG), *args],
        cwd=str(REPO),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1", "LANG": "C.UTF-8"},
        timeout=120,
        check=False,
    )


def record(case: str, expectation: str, ok: bool, detail: str) -> None:
    RESULTS.append({"case": case, "expectation": expectation, "ok": bool(ok), "detail": detail[:600]})
    print(("PASS  " if ok else "FAIL  ") + case + " :: " + detail[:200], file=sys.stderr)


def subagent_entries(catalog: dict, tool: str) -> dict[str, int]:
    out = {}
    for role, entries in catalog.get("roles", {}).items():
        for entry in entries:
            if entry.get("tool") == tool and entry.get("invocation") == "subagent":
                out[role] = out.get(role, 0) + 1
    return out


def base_registry() -> dict:
    return json.loads(PROJECT_REGISTRY.read_text())


def future_adapter() -> dict:
    return {
        "_comment": "Evaluator-owned synthetic future CLI adapter (temp tree only).",
        "name": "futurecli",
        "tool": "futurecli",
        "model_family": "futurefam",
        "envelope_delivery": "argv",
        "argv": ["futurecli", "-p", "{{envelope_json}}"],
        "bridge_commands": {"acp-native-agent/v1": ["futurecli", "acp"]},
        "artifact_relpath": "docs/test-reports/{{batch}}-verdict.json",
        "env_allowlist_extra": [],
        "_verified": True,
    }


def future_bridge(bridge_id: str = "future-acp-native-agent") -> dict:
    return {
        "id": bridge_id,
        "_verified": True,
        "session_scope": "same-session",
        "strategy": "session-bridge-v1",
        "protocol": {
            "kind": "acp-native-agent/v1",
            "command": ["futurecli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        },
        "personas": {
            "planner": "planner-proposal",
            "generator": "generator-restricted",
            "evaluator": "evaluator",
        },
        "native_agent_types": {"planner": "plan", "generator": "coder", "evaluator": "explore"},
    }


def future_integration(bridge_id: str = "future-acp-native-agent") -> dict:
    return {
        "id": "futurecli",
        "tool": "futurecli",
        "label": "Future CLI",
        "model_family": "futurefam",
        "priority": 100,
        "capabilities": ["plan", "build", "fix", "verify", "l1_local"],
        "subagent": {"bridge": bridge_id},
        "local_cli": {
            "adapter": "futurecli",
            "sandbox": {"home_dir": "~/.harness-sandbox/futurecli", "env_set": {}, "env_allow": []},
            "timeout_s": 2400,
        },
    }


def workspace(tmp: Path) -> tuple[Path, Path]:
    adapters = tmp / "adapters"
    bridges = tmp / "bridges"
    shutil.copytree(ADAPTERS, adapters)
    shutil.copytree(BRIDGES, bridges)
    (adapters / "futurecli.json").write_text(json.dumps(future_adapter(), indent=2))
    return adapters, bridges


def catalog_of(registry: dict, adapters: Path, bridges: Path, tmp: Path, name: str) -> subprocess.CompletedProcess:
    path = tmp / f"registry-{name}.json"
    path.write_text(json.dumps(registry, indent=2))
    return run(["catalog", "--registry", str(path), "--adapters", str(adapters), "--bridges", str(bridges)])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path)
    options = parser.parse_args()

    with tempfile.TemporaryDirectory() as raw_tmp:
        tmp = Path(raw_tmp)
        adapters, bridges = workspace(tmp)

        # --- Case 1: attested host publishes exactly the declared Kimi bridge ---
        proc = run(["catalog", "--registry", str(PROJECT_REGISTRY)])
        provider_attested = False
        if proc.returncode == 0:
            catalog = json.loads(proc.stdout)
            kimi = subagent_entries(catalog, "kimi")
            codex = subagent_entries(catalog, "codex")
            claude = subagent_entries(catalog, "claude-code")
            provider_attested = set(kimi) == {"planner", "generator", "evaluator"}
            record(
                "project-catalog-three-role-kimi-bridge",
                "kimi subagent published for planner/generator/evaluator; codex and legacy claude-code publish none",
                provider_attested and not codex and not claude,
                f"kimi={kimi} codex={codex} claude-code={claude}",
            )
        else:
            record("project-catalog-three-role-kimi-bridge", "catalog must succeed", False, proc.stderr)

        # --- Case 2: resolved targets carry non-signable bridge provenance ---
        required = {
            "bridge_id",
            "bridge_strategy",
            "session_scope",
            "bridge_protocol",
            "bridge_provider_id",
            "bridge_provider_kind",
            "bridge_provider_contract_sha256",
            "execution_provenance_sha256",
            "agent_type",
            "native_agent_type",
        }
        targets: dict[str, dict] = {}
        for role in ("planner", "generator", "evaluator"):
            got = run(["target", "--registry", str(PROJECT_REGISTRY), "--target-id", f"subagent--kimi--{role}"])
            if got.returncode != 0:
                record(f"target-provenance-{role}", "target resolves with bridge provenance", False, got.stderr)
                continue
            target = json.loads(got.stdout)
            targets[role] = target
            missing = sorted(required - set(target))
            record(
                f"target-provenance-{role}",
                "target carries bridge + provider provenance and execution_provenance_sha256",
                not missing and target.get("session_scope") == "same-session",
                f"missing={missing} provider={target.get('bridge_provider_kind')} "
                f"epsha={str(target.get('execution_provenance_sha256'))[:16]}",
            )
        record(
            "target-provenance-distinct-per-role",
            "each role persona yields a distinct execution provenance digest",
            len({t["execution_provenance_sha256"] for t in targets.values()}) == len(targets) and len(targets) == 3,
            str({r: t["execution_provenance_sha256"][:12] for r, t in targets.items()}),
        )

        # --- Case 3: the signable payload cannot name a bridge ---
        good = tmp / "bindings-good.json"
        good.write_text(json.dumps({
            "planner": {"tool": "kimi", "invocation": "subagent"},
            "generator": {"tool": "kimi", "invocation": "subagent"},
            "evaluator": {"tool": "codex", "invocation": "local-cli"},
        }))
        resolved = run(["resolve", "--registry", str(PROJECT_REGISTRY), "--bindings", str(good)])
        leaked = []
        if resolved.returncode == 0:
            payload = json.loads(resolved.stdout)
            for role, value in payload.items():
                if value is None:
                    continue
                leaked += [k for k in value if k.startswith("bridge") or k in {"agent_type", "sandbox", "adapter"}]
            record(
                "signed-binding-resolves-bridge",
                "a {tool,invocation} binding alone resolves the bridge target and returns execution provenance",
                not leaked
                and all(
                    value is None or "execution_provenance_sha256" in value for value in payload.values()
                ),
                f"leaked_fields={leaked} payload_keys={sorted(payload)}",
            )
        else:
            record("signed-binding-resolves-bridge", "binding resolves", False, resolved.stderr)

        bad = tmp / "bindings-bridge.json"
        bad.write_text(json.dumps({
            "planner": None,
            "generator": {"tool": "kimi", "invocation": "subagent", "bridge": "kimi-acp-native-agent"},
            "evaluator": {"tool": "codex", "invocation": "local-cli"},
        }))
        rejected = run(["resolve", "--registry", str(PROJECT_REGISTRY), "--bindings", str(bad)])
        record(
            "signed-binding-cannot-name-bridge",
            "a signature carrying bridge provenance is rejected (provenance is runtime-only)",
            rejected.returncode != 0 and "extra=['bridge']" in rejected.stderr,
            rejected.stderr.strip(),
        )

        legacy_binding = tmp / "bindings-legacy.json"
        legacy_binding.write_text(json.dumps({
            "planner": None,
            "generator": {"tool": "claude-code", "invocation": "subagent"},
            "evaluator": {"tool": "codex", "invocation": "local-cli"},
        }))
        legacy = run(["resolve", "--registry", str(PROJECT_REGISTRY), "--bindings", str(legacy_binding)])
        record(
            "legacy-host-native-not-external-route",
            "legacy `subagent: true` stays Coordinator-internal and is not signable as an external bridge",
            legacy.returncode != 0 and "no eligible agent" in legacy.stderr,
            legacy.stderr.strip(),
        )

        # --- Case 4: a future CLI joins declaratively, with no tool-name change ---
        registry = base_registry()
        registry["integrations"].append(future_integration())
        (bridges / "future-acp-native-agent.json").write_text(json.dumps(future_bridge(), indent=2))
        proc = catalog_of(registry, adapters, bridges, tmp, "future")
        future_roles: dict[str, int] = {}
        if proc.returncode == 0:
            future_roles = subagent_entries(json.loads(proc.stdout), "futurecli")
        record(
            "future-cli-auto-enters-catalog",
            "a new CLI with its own verified manifest on the published protocol enters the catalog with no code change",
            set(future_roles) == {"planner", "generator", "evaluator"},
            f"rc={proc.returncode} futurecli={future_roles} err={proc.stderr.strip()[:200]}",
        )
        if proc.returncode == 0:
            future_target = run([
                "target", "--registry", str(tmp / "registry-future.json"),
                "--adapters", str(adapters), "--bridges", str(bridges),
                "--target-id", "subagent--futurecli--generator",
            ])
            ok = future_target.returncode == 0
            body = json.loads(future_target.stdout) if ok else {}
            record(
                "future-cli-target-provenance",
                "the future CLI target carries the same provider/bridge provenance contract",
                ok and body.get("bridge_id") == "future-acp-native-agent"
                and body.get("bridge_provider_kind") in {"vm-v1", "ephemeral-uid-v1"}
                and "execution_provenance_sha256" in body,
                f"rc={future_target.returncode} bridge={body.get('bridge_id')} provider={body.get('bridge_provider_id')}",
            )

        # --- Case 5: fail-closed matrix ---
        def negative(name: str, expectation: str, mutate) -> None:
            reg = base_registry()
            reg["integrations"].append(future_integration())
            manifest = future_bridge()
            manifest_name = "future-acp-native-agent"
            adapter = future_adapter()
            manifest_name = mutate(reg, manifest, adapter) or manifest_name
            case_bridges = tmp / f"bridges-{name}"
            case_adapters = tmp / f"adapters-{name}"
            shutil.copytree(BRIDGES, case_bridges)
            shutil.copytree(ADAPTERS, case_adapters)
            (case_adapters / "futurecli.json").write_text(json.dumps(adapter, indent=2))
            if manifest is not None:
                (case_bridges / f"{manifest_name}.json").write_text(json.dumps(manifest, indent=2))
            proc = catalog_of(reg, case_adapters, case_bridges, tmp, name)
            published = {}
            if proc.returncode == 0:
                published = subagent_entries(json.loads(proc.stdout), "futurecli")
            record(
                f"fail-closed/{name}",
                expectation,
                proc.returncode != 0 and not published,
                f"rc={proc.returncode} published={published} err={proc.stderr.strip()[:300]}",
            )

        def unknown_bridge(reg, manifest, adapter):
            reg["integrations"][-1]["subagent"] = {"bridge": "no-such-bridge"}
            return None

        def unverified(reg, manifest, adapter):
            manifest["_verified"] = False
            return None

        def role_overreach(reg, manifest, adapter):
            manifest["personas"]["planner"] = "evaluator"
            return None

        def unknown_role(reg, manifest, adapter):
            manifest["personas"]["coordinator"] = "coordinator"
            manifest["native_agent_types"]["coordinator"] = "plan"
            return None

        def persona_type_mismatch(reg, manifest, adapter):
            manifest["native_agent_types"].pop("generator")
            return None

        def unpublished_native_type(reg, manifest, adapter):
            manifest["native_agent_types"]["generator"] = "root"
            return None

        def command_mismatch(reg, manifest, adapter):
            manifest["protocol"]["command"] = ["futurecli", "serve"]
            return None

        def command_foreign_executable(reg, manifest, adapter):
            manifest["protocol"]["command"] = ["kimi", "acp"]
            adapter["bridge_commands"]["acp-native-agent/v1"] = ["kimi", "acp"]
            return None

        def adapter_no_bridge_command(reg, manifest, adapter):
            adapter.pop("bridge_commands")
            return None

        def unpublished_protocol(reg, manifest, adapter):
            manifest["protocol"]["kind"] = "mcp-child/v1"
            adapter["bridge_commands"] = {"mcp-child/v1": ["futurecli", "acp"]}
            return None

        def manifest_id_drift(reg, manifest, adapter):
            manifest["id"] = "some-other-bridge"
            return None

        def scope_drift(reg, manifest, adapter):
            manifest["session_scope"] = "cross-session"
            return None

        def extra_manifest_field(reg, manifest, adapter):
            manifest["allow_host_fs"] = True
            return None

        def bridge_without_local_cli(reg, manifest, adapter):
            reg["integrations"][-1].pop("local_cli")
            return None

        def unverified_adapter(reg, manifest, adapter):
            adapter["_verified"] = False
            return None

        def traversal_bridge_id(reg, manifest, adapter):
            reg["integrations"][-1]["subagent"] = {"bridge": "../../../etc/passwd"}
            return None

        def legacy_true_on_external(reg, manifest, adapter):
            reg["integrations"][-1]["subagent"] = {"bridge": "future-acp-native-agent", "trusted": True}
            return None

        for name, expectation, mutate in [
            ("unknown-bridge-id", "an undeclared/missing manifest cannot publish a route", unknown_bridge),
            ("manifest-not-verified", "_verified must be true", unverified),
            ("role-persona-overreach", "a persona may not claim another role's contract", role_overreach),
            ("unknown-role-persona", "personas outside the three framework roles are rejected", unknown_role),
            ("persona-type-set-mismatch", "native_agent_types must cover exactly the persona roles", persona_type_mismatch),
            ("unpublished-native-agent-type", "only published native agent types are accepted", unpublished_native_type),
            ("bridge-command-mismatch", "manifest command must equal the verified adapter bridge command", command_mismatch),
            ("bridge-command-foreign-executable", "the bridge command may not launch another CLI's executable", command_foreign_executable),
            ("adapter-declares-no-bridge-command", "adapters must authorize the bridge launch command", adapter_no_bridge_command),
            ("unpublished-protocol-kind", "an unreleased protocol kind cannot enter the catalog", unpublished_protocol),
            ("manifest-id-drift", "manifest id must match its filename", manifest_id_drift),
            ("session-scope-drift", "session_scope must be same-session", scope_drift),
            ("unknown-manifest-field", "config drift adds no unknown manifest knobs", extra_manifest_field),
            ("bridge-without-local-cli", "an external bridge inherits a verified local-cli contract", bridge_without_local_cli),
            ("unverified-adapter", "an unverified adapter cannot back a bridge", unverified_adapter),
            ("bridge-id-path-traversal", "bridge ids cannot traverse the manifest directory", traversal_bridge_id),
            ("subagent-declaration-extra-key", "the subagent declaration is a closed object", legacy_true_on_external),
        ]:
            negative(name, expectation, mutate)

        # --- Case 6: no fallback to the user example registry ---
        fake_repo = tmp / "no-registry-repo"
        (fake_repo / ".claude" / "dispatch").mkdir(parents=True)
        shutil.copy(
            REPO / "framework" / "templates" / "claude" / "dispatch" / "agents-registry.example.json",
            fake_repo / ".claude" / "dispatch" / "agents-registry.example.json",
        )
        missing = run(["catalog", "--registry", str(fake_repo / ".agents-registry.json")])
        record(
            "missing-project-registry-no-example-fallback",
            "a missing project registry fails closed instead of reading the user example registry",
            missing.returncode != 0 and missing.stdout.strip() == "",
            f"rc={missing.returncode} err={missing.stderr.strip()[:200]}",
        )

        # --- Case 7: execution provenance binds bridge semantics, not prose ---
        prose = tmp / "bridges-prose"
        shutil.copytree(BRIDGES, prose)
        manifest = json.loads((BRIDGES / "kimi-acp-native-agent.json").read_text())
        prose_manifest = copy.deepcopy(manifest)
        prose_manifest["notes"] = "evaluator prose-only edit"
        (prose / "kimi-acp-native-agent.json").write_text(json.dumps(prose_manifest, indent=2))
        prose_target = run([
            "target", "--registry", str(PROJECT_REGISTRY), "--adapters", str(ADAPTERS),
            "--bridges", str(prose), "--target-id", "subagent--kimi--generator",
        ])

        drift = tmp / "bridges-drift"
        shutil.copytree(BRIDGES, drift)
        drift_manifest = copy.deepcopy(manifest)
        drift_manifest["native_agent_types"]["generator"] = "explore"
        (drift / "kimi-acp-native-agent.json").write_text(json.dumps(drift_manifest, indent=2))
        drift_target = run([
            "target", "--registry", str(PROJECT_REGISTRY), "--adapters", str(ADAPTERS),
            "--bridges", str(drift), "--target-id", "subagent--kimi--generator",
        ])
        baseline = targets.get("generator", {}).get("execution_provenance_sha256")
        prose_sha = json.loads(prose_target.stdout).get("execution_provenance_sha256") if prose_target.returncode == 0 else None
        drift_sha = json.loads(drift_target.stdout).get("execution_provenance_sha256") if drift_target.returncode == 0 else None
        record(
            "execution-provenance-binds-semantics",
            "documentation edits keep the digest stable; a semantic manifest change moves it",
            bool(baseline) and prose_sha == baseline and drift_sha not in (None, baseline),
            f"baseline={str(baseline)[:12]} prose={str(prose_sha)[:12]} drift={str(drift_sha)[:12]}",
        )

    summary = {
        "total": len(RESULTS),
        "passed": sum(1 for item in RESULTS if item["ok"]),
        "failed": [item["case"] for item in RESULTS if not item["ok"]],
        "provider_attested_during_run": provider_attested,
        "results": RESULTS,
    }
    text = json.dumps(summary, indent=2, ensure_ascii=False)
    print(text)
    if options.out:
        options.out.write_text(text + "\n")
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
