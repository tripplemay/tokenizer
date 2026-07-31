#!/usr/bin/env python3
"""Focused executable fixtures for the registry-driven tool catalog."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
TOOL_CATALOG = HERE / "tool-catalog.py"
DISPATCH_VALIDATOR = HERE / "validate-dispatch.sh"
RESOLVED_BINDINGS_VALIDATOR = HERE / "validate-resolved-mode-bindings.sh"


def adapter(name: str, family: str, *, verified: bool = True, tool: str | None = None) -> dict:
    value = {
        "name": name,
        "model_family": family,
        "argv": ["fixture-cli"],
        "envelope_delivery": "stdin",
        "_verified": verified,
    }
    if tool is not None:
        value["tool"] = tool
    return value


def local_agent(
    agent_id: str,
    role: str,
    adapter_name: str,
    family: str,
    *,
    priority: int = 100,
    tool: str | None = None,
) -> dict:
    value = {
        "id": agent_id,
        "roles": [role],
        "transport": "local-cli",
        "adapter": adapter_name,
        "model_family": family,
        "priority": priority,
        "capabilities": [role],
        "sandbox": {"home_dir": f"/tmp/tool-catalog-{agent_id}"},
        "constraints": {
            "l2": False,
            "write_src": role == "generator",
            "push": False,
        },
    }
    if tool is not None:
        value["tool"] = tool
    return value


class ToolCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.adapters = self.root / "adapters"
        self.adapters.mkdir()
        self.registry = self.root / "registry.json"
        self.bindings = self.root / "bindings.json"

    def tearDown(self):
        self.temp.cleanup()

    def write_adapter(self, name: str, family: str, **kwargs):
        (self.adapters / f"{name}.json").write_text(
            json.dumps(adapter(name, family, **kwargs)), encoding="utf-8"
        )

    def write_registry(self, agents: list[dict]):
        self.registry.write_text(
            json.dumps({"version": "dispatch/1", "agents": agents}), encoding="utf-8"
        )

    def write_bindings(self, bindings: dict):
        self.bindings.write_text(json.dumps(bindings), encoding="utf-8")

    def invoke(self, command: str):
        args = [
            sys.executable,
            str(TOOL_CATALOG),
            command,
            "--registry",
            str(self.registry),
            "--adapters",
            str(self.adapters),
        ]
        if command == "resolve":
            args.extend(["--bindings", str(self.bindings)])
        return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def invoke_registry_validator(self):
        return subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "registry", str(self.registry)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def write_valid_pool(self):
        self.write_adapter("new-cli", "new")
        self.write_adapter("generator-cli", "generator")
        self.write_adapter("evaluator-cli", "evaluator")
        self.write_registry(
            [
                local_agent("planner-slower", "planner", "new-cli", "new", priority=40),
                local_agent("planner-preferred", "planner", "new-cli", "new", priority=10),
                local_agent("generator", "generator", "generator-cli", "generator", priority=20),
                local_agent("evaluator", "evaluator", "evaluator-cli", "evaluator", priority=20),
                {
                    "id": "builtin-planner",
                    "roles": ["planner"],
                    "transport": "subagent",
                    "agent_type": "planner-proposal",
                    "model_family": "claude",
                    "capabilities": ["plan"],
                },
            ]
        )
        self.write_bindings(
            {
                "planner": {"tool": "new-cli", "invocation": "local-cli"},
                "generator": {"tool": "generator-cli", "invocation": "local-cli"},
                "evaluator": {"tool": "evaluator-cli", "invocation": "local-cli"},
            }
        )

    def test_catalog_auto_discovers_adapter_tool_and_hides_agent_ids(self):
        self.write_valid_pool()
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = json.loads(result.stdout)
        self.assertEqual(catalog["version"], "tool-catalog/1")
        planner_entries = catalog["roles"]["planner"]
        by_choice = {(item["tool"], item["invocation"]): item for item in planner_entries}
        self.assertIn(("new-cli", "local-cli"), by_choice)
        self.assertIn(("claude-code", "subagent"), by_choice)
        self.assertEqual(by_choice[("new-cli", "local-cli")]["agent_count"], 2)
        self.assertNotIn("agent_id", by_choice[("new-cli", "local-cli")])

    def test_resolve_uses_priority_then_id_and_keeps_audit_metadata(self):
        self.write_valid_pool()
        result = self.invoke("resolve")
        self.assertEqual(result.returncode, 0, result.stderr)
        resolved = json.loads(result.stdout)
        self.assertEqual(resolved["planner"]["agent_id"], "planner-preferred")
        self.assertEqual(resolved["planner"]["tool"], "new-cli")
        self.assertEqual(resolved["planner"]["invocation"], "local-cli")
        self.assertEqual(resolved["generator"]["agent_id"], "generator")
        self.assertEqual(resolved["evaluator"]["agent_id"], "evaluator")
        self.assertNotEqual(
            resolved["generator"]["model_family"], resolved["evaluator"]["model_family"]
        )

    def test_resolve_breaks_priority_ties_by_agent_id(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"][0]["priority"] = 10
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("resolve")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["planner"]["agent_id"], "planner-preferred")

    def test_rejects_unverified_local_cli_adapter(self):
        self.write_valid_pool()
        self.write_adapter("new-cli", "new", verified=False)
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("not verified", result.stderr)

    def test_rejects_explicit_tool_that_disagrees_with_adapter_metadata(self):
        self.write_valid_pool()
        self.write_adapter("new-cli", "new", tool="adapter-tool")
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"][0]["tool"] = "wrong-tool"
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("disagrees", result.stderr)

    def test_explicit_tool_overrides_adapter_name_when_adapter_has_no_tool_metadata(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"][0]["tool"] = "new-cli-stable"
        registry["agents"][1]["tool"] = "new-cli-stable"
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 0, result.stderr)
        planner_entries = json.loads(result.stdout)["roles"]["planner"]
        self.assertIn(
            ("new-cli-stable", "local-cli"),
            {(item["tool"], item["invocation"]) for item in planner_entries},
        )

    def test_adapter_tool_metadata_becomes_the_canonical_tool_without_descriptor_tool(self):
        self.write_valid_pool()
        self.write_adapter("new-cli", "new", tool="new-cli-canonical")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 0, result.stderr)
        planner_entries = json.loads(result.stdout)["roles"]["planner"]
        self.assertIn(
            ("new-cli-canonical", "local-cli"),
            {(item["tool"], item["invocation"]) for item in planner_entries},
        )

    def test_a2a_without_tool_falls_back_to_model_family(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"].append(
            {
                "id": "remote-planner",
                "roles": ["planner"],
                "transport": "a2a",
                "endpoint": "https://example.invalid/a2a",
                "model_family": "remote-family",
            }
        )
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 0, result.stderr)
        planner_entries = json.loads(result.stdout)["roles"]["planner"]
        self.assertIn(
            ("remote-family", "a2a"),
            {(item["tool"], item["invocation"]) for item in planner_entries},
        )

    def test_a2a_auth_contract_is_identical_for_registry_and_catalog(self):
        self.write_valid_pool()
        original_registry = json.loads(self.registry.read_text(encoding="utf-8"))
        base = {
            "id": "remote-planner",
            "roles": ["planner"],
            "transport": "a2a",
            "endpoint": "https://example.invalid/a2a",
            "model_family": "remote-family",
        }
        cases = [
            ("missing auth defaults to none", False, None, 0),
            ("explicit none", True, {"type": "none"}, 0),
            ("safe bearer variable", True, {"type": "bearer", "env": "REMOTE_A2A_TOKEN"}, 0),
            ("safe bearer variable with numeric suffix", True, {"type": "bearer", "env": "REMOTE_A2A_1"}, 0),
            ("null auth", True, None, 2),
            ("empty auth", True, {}, 2),
            ("none carries env", True, {"type": "none", "env": "REMOTE_A2A_TOKEN"}, 2),
            ("bearer misses env", True, {"type": "bearer"}, 2),
            ("unknown auth type", True, {"type": "oauth", "env": "REMOTE_A2A_TOKEN"}, 2),
            ("extra auth field", True, {"type": "bearer", "env": "REMOTE_A2A_TOKEN", "scope": "all"}, 2),
            ("bad env syntax", True, {"type": "bearer", "env": "REMOTE-TOKEN"}, 2),
            ("protected home", True, {"type": "bearer", "env": "HOME"}, 2),
            ("protected harness", True, {"type": "bearer", "env": "HARNESS_CONSOLE_SIGNING_KEY"}, 2),
            ("protected git", True, {"type": "bearer", "env": "GIT_ASKPASS"}, 2),
            ("unscoped host secret", True, {"type": "bearer", "env": "OPENAI_API_KEY"}, 2),
        ]
        for name, has_auth, auth, expected in cases:
            with self.subTest(name=name):
                registry = json.loads(json.dumps(original_registry))
                descriptor = dict(base)
                if has_auth:
                    descriptor["auth"] = auth
                registry["agents"].append(descriptor)
                self.registry.write_text(json.dumps(registry), encoding="utf-8")
                preflight = self.invoke_registry_validator()
                catalog = self.invoke("catalog")
                self.assertEqual(preflight.returncode, expected, preflight.stdout + preflight.stderr)
                self.assertEqual(catalog.returncode, expected, catalog.stdout + catalog.stderr)

    def test_auth_is_rejected_when_non_a2a_descriptor_cannot_consume_it(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"][0]["auth"] = {"type": "none"}
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        preflight = self.invoke_registry_validator()
        catalog = self.invoke("catalog")
        self.assertEqual(preflight.returncode, 2)
        self.assertIn("auth", preflight.stdout)
        self.assertEqual(catalog.returncode, 2)
        self.assertIn("only supported", catalog.stderr)

    def test_catalog_rejects_a2a_generator_without_source_handoff(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"].append(
            {
                "id": "remote-generator",
                "roles": ["generator"],
                "transport": "a2a",
                "endpoint": "https://example.invalid/a2a",
                "model_family": "remote-family",
            }
        )
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("source-handoff", result.stderr)

    def test_catalog_rejects_non_proposal_subagent_planner(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        builtin = next(agent for agent in registry["agents"] if agent["id"] == "builtin-planner")
        builtin["agent_type"] = "planner"
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("planner-proposal", result.stderr)

    def test_catalog_rejects_unsafe_agent_id_before_dispatch_can_interpolate_it(self):
        self.write_valid_pool()
        registry = json.loads(self.registry.read_text(encoding="utf-8"))
        registry["agents"][0]["id"] = "planner; echo injected"
        self.registry.write_text(json.dumps(registry), encoding="utf-8")
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("controlled dispatch shell arguments", result.stderr)

    def test_registry_preflight_rejects_duplicate_roles_before_catalog_resolution(self):
        self.write_registry(
            [
                {
                    "id": "duplicate-role",
                    "roles": ["evaluator", "evaluator"],
                    "transport": "subagent",
                    "agent_type": "evaluator",
                    "model_family": "fixture",
                    "constraints": {"l2": False, "write_src": False, "push": False},
                }
            ]
        )
        result = self.invoke_registry_validator()
        self.assertEqual(result.returncode, 2)
        self.assertIn("roles", result.stdout)

    def test_registry_preflight_rejects_non_string_model_family_before_catalog_resolution(self):
        self.write_registry(
            [
                {
                    "id": "bad-family",
                    "roles": ["evaluator"],
                    "transport": "subagent",
                    "agent_type": "evaluator",
                    "model_family": 7,
                    "constraints": {"l2": False, "write_src": False, "push": False},
                }
            ]
        )
        result = self.invoke_registry_validator()
        self.assertEqual(result.returncode, 2)
        self.assertIn("model_family", result.stdout)

    def test_resolve_rejects_missing_tool_invocation_candidate(self):
        self.write_valid_pool()
        bindings = json.loads(self.bindings.read_text(encoding="utf-8"))
        bindings["planner"] = {"tool": "missing-cli", "invocation": "local-cli"}
        self.write_bindings(bindings)
        result = self.invoke("resolve")
        self.assertEqual(result.returncode, 2)
        self.assertIn("no eligible agent", result.stderr)

    def test_resolve_rejects_generator_evaluator_same_model_family(self):
        self.write_adapter("same-generator", "same")
        self.write_adapter("same-evaluator", "same")
        self.write_registry(
            [
                {
                    "id": "builtin-planner",
                    "roles": ["planner"],
                    "transport": "subagent",
                    "agent_type": "planner-proposal",
                    "model_family": "claude",
                },
                local_agent("generator", "generator", "same-generator", "same"),
                local_agent("evaluator", "evaluator", "same-evaluator", "same"),
            ]
        )
        self.write_bindings(
            {
                "planner": {"tool": "claude-code", "invocation": "subagent"},
                "generator": {"tool": "same-generator", "invocation": "local-cli"},
                "evaluator": {"tool": "same-evaluator", "invocation": "local-cli"},
            }
        )
        result = self.invoke("resolve")
        self.assertEqual(result.returncode, 2)
        self.assertIn("different model_family", result.stderr)

    def test_runtime_validator_rejects_legacy_v2_resolution_without_signed_checkpoint(self):
        self.write_valid_pool()
        resolved = self.invoke("resolve")
        self.assertEqual(resolved.returncode, 0, resolved.stderr)
        resolution = json.loads(resolved.stdout)
        progress = self.root / "progress.json"
        progress.write_text(
            json.dumps(
                {
                    "role_assignments": {
                        role: resolution[role]["agent_id"]
                        for role in ("planner", "generator", "evaluator")
                    },
                    "mode_intent": {"resolution": resolution},
                }
            ),
            encoding="utf-8",
        )
        command = [
            "bash", str(RESOLVED_BINDINGS_VALIDATOR),
            "--progress", str(progress),
            "--registry", str(self.registry),
            "--adapters", str(self.adapters),
            "--pub", str(self.root / "console.pub"),
        ]
        (self.root / "console.pub").write_text("fixture public key not reached\n", encoding="utf-8")
        rejected = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("checkpoint", rejected.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
