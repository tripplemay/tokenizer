#!/usr/bin/env python3
"""Focused executable fixtures for the registry-driven tool catalog."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


HERE = Path(__file__).resolve().parent
TOOL_CATALOG = HERE / "tool-catalog.py"
DISPATCH_VALIDATOR = HERE / "validate-dispatch.sh"
RESOLVED_BINDINGS_VALIDATOR = HERE / "validate-resolved-mode-bindings.sh"


def load_tool_catalog_module():
    """Load the CLI module directly so host capability can be fail-closed tested."""
    sys.path.insert(0, str(HERE))
    spec = importlib.util.spec_from_file_location("tool_catalog_test_support", TOOL_CATALOG)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TOOL_CATALOG_MODULE = load_tool_catalog_module()


def adapter(name: str, family: str, *, verified: bool = True, tool: str | None = None) -> dict:
    value = {
        "name": name,
        "model_family": family,
        "argv": [name],
        "envelope_delivery": "stdin",
        "bridge_commands": {
            "acp-native-agent/v1": [name, "acp"],
        },
        "_verified": verified,
    }
    if tool is not None:
        value["tool"] = tool
    return value


def subagent_bridge(
    bridge_id: str,
    *,
    verified: bool = True,
    strategy: str = "native-session",
    protocol_kind: str = "acp-native-agent/v1",
    command: list[str] | None = None,
    personas: dict[str, str] | None = None,
    native_agent_types: dict[str, str] | None = None,
    deliverable_channels: dict[str, str] | None = None,
) -> dict:
    selected_personas = personas or {
        "planner": "planner-proposal",
        "evaluator": "evaluator",
    }
    selected_native_types = native_agent_types or {
        role: {"planner": "plan", "generator": "coder", "evaluator": "explore"}[role]
        for role in selected_personas
    }
    manifest = {
        "id": bridge_id,
        "_verified": verified,
        "session_scope": "same-session",
        "strategy": strategy,
        "protocol": {
            "kind": protocol_kind,
            "command": command or ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        },
        "personas": selected_personas,
        "native_agent_types": selected_native_types,
    }
    if deliverable_channels is not None:
        manifest["deliverable_channels"] = deliverable_channels
    return manifest


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
        self.bridges = self.root / "bridges"
        self.bridges.mkdir()
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

    def write_bridge(self, bridge_id: str, **kwargs):
        (self.bridges / f"{bridge_id}.json").write_text(
            json.dumps(subagent_bridge(bridge_id, **kwargs)), encoding="utf-8"
        )

    def write_integrations(self, integrations: list[dict], a2a_targets: list[dict] | None = None):
        self.registry.write_text(
            json.dumps({
                "version": "tool-integrations/1",
                "integrations": integrations,
                "a2a_targets": a2a_targets or [],
            }),
            encoding="utf-8",
        )

    def write_bindings(self, bindings: dict):
        self.bindings.write_text(json.dumps(bindings), encoding="utf-8")

    def invoke(self, command: str, *, target_id: str | None = None):
        args = [
            sys.executable,
            str(TOOL_CATALOG),
            command,
            "--registry",
            str(self.registry),
            "--adapters",
            str(self.adapters),
            "--bridges",
            str(self.bridges),
        ]
        if command == "resolve":
            args.extend(["--bindings", str(self.bindings)])
        if command == "target":
            if target_id is None:
                raise AssertionError("target_id is required for target command")
            args.extend(["--target-id", target_id])
        return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def attested_strict_provider(self, *, tool: str = "future-cli"):
        """A test-only stand-in for a future framework-owned VM provider."""
        route = TOOL_CATALOG_MODULE.AttestedExternalBridgeRoute(
            tool=tool,
            protocol_kind="acp-native-agent/v1",
            command=(tool, "acp"),
            request_delivery="stdin",
            response_format="json",
        )
        return TOOL_CATALOG_MODULE.StrictExternalBridgeProvider(
            id="fixture-vm-provider",
            kind="vm-v1",
            contract_sha256="a" * 64,
            supported_routes=(route,),
        )

    def candidates_with_attested_strict_provider(self, *, tool: str = "future-cli"):
        # The CLI subprocess must stay fail-closed in this release.  Patch the
        # in-process framework hook only to prove that any future provider can
        # admit a protocol-compatible new CLI declaratively.
        with mock.patch.object(
            TOOL_CATALOG_MODULE,
            "external_same_session_bridge_provider",
            return_value=self.attested_strict_provider(tool=tool),
        ):
            return TOOL_CATALOG_MODULE.candidates_from_registry(
                self.registry, self.adapters, self.bridges
            )

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
        self.assertNotIn(("claude-code", "subagent"), by_choice)
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
        for record in resolved.values():
            self.assertRegex(record["execution_provenance_sha256"], r"^[0-9a-f]{64}$")
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
                "planner": None,
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

    def test_integrations_auto_expand_cli_roles_and_keep_coordinator_planner_null(self):
        self.write_adapter("future-cli", "future")
        self.write_adapter("other-cli", "other")
        self.write_integrations(
            [
                {
                    "id": "future",
                    "tool": "future-cli",
                    "label": "Future CLI",
                    "model_family": "future",
                    "capabilities": ["plan", "build", "verify"],
                    "local_cli": {
                        "adapter": "future-cli",
                        "sandbox": {"home_dir": "/tmp/future-home"},
                        "timeout_s": 900,
                    },
                },
                {
                    "id": "other",
                    "tool": "other-cli",
                    "label": "Other CLI",
                    "model_family": "other",
                    "local_cli": {
                        "adapter": "other-cli",
                        "sandbox": {"home_dir": "/tmp/other-home"},
                    },
                },
                {
                    "id": "claude",
                    "tool": "claude-code",
                    "label": "Claude Code",
                    "model_family": "claude",
                    "subagent": True,
                },
            ],
            [
                {
                    "id": "future-remote",
                    "integration_id": "future",
                    "remote_runner_id": "future-a2a-runner",
                    "endpoint": "https://future.invalid/a2a",
                    "auth": {"type": "none"},
                }
            ],
        )
        self.write_bindings(
            {
                "planner": None,
                "generator": {"tool": "future-cli", "invocation": "local-cli"},
                "evaluator": {"tool": "other-cli", "invocation": "local-cli"},
            }
        )

        catalog_result = self.invoke("catalog")
        self.assertEqual(catalog_result.returncode, 0, catalog_result.stderr)
        catalog = json.loads(catalog_result.stdout)
        for role in ("planner", "generator", "evaluator"):
            self.assertIn(
                ("future-cli", "local-cli"),
                {(entry["tool"], entry["invocation"]) for entry in catalog["roles"][role]},
            )
        self.assertIn(
            ("future-cli", "a2a"),
            {(entry["tool"], entry["invocation"]) for entry in catalog["roles"]["planner"]},
        )
        self.assertIn(
            ("future-cli", "a2a"),
            {(entry["tool"], entry["invocation"]) for entry in catalog["roles"]["evaluator"]},
        )
        self.assertNotIn(
            ("future-cli", "a2a"),
            {(entry["tool"], entry["invocation"]) for entry in catalog["roles"]["generator"]},
        )
        self.assertNotIn(
            ("claude-code", "subagent"),
            {(entry["tool"], entry["invocation"]) for entry in catalog["roles"]["generator"]},
        )

        resolved_result = self.invoke("resolve")
        self.assertEqual(resolved_result.returncode, 0, resolved_result.stderr)
        resolved = json.loads(resolved_result.stdout)
        self.assertIsNone(resolved["planner"])
        self.assertEqual(resolved["generator"]["agent_id"], "local-cli--future--generator")
        self.assertEqual(resolved["evaluator"]["agent_id"], "local-cli--other--evaluator")

        local_target = self.invoke("target", target_id="local-cli--future--generator")
        self.assertEqual(local_target.returncode, 0, local_target.stderr)
        local_target_value = json.loads(local_target.stdout)
        self.assertEqual(
            {
                key: value
                for key, value in local_target_value.items()
                if key not in {
                    "adapter_execution_contract_sha256",
                    "execution_provenance_sha256",
                }
            },
            {
                "adapter": "future-cli",
                "capabilities": ["build", "plan", "verify"],
                "integration_id": "future",
                "invocation": "local-cli",
                "model_family": "future",
                "priority": 1000,
                "roles": ["generator"],
                "sandbox": {"home_dir": "/tmp/future-home"},
                "target_id": "local-cli--future--generator",
                "timeout_s": 900,
                "tool": "future-cli",
            },
        )
        self.assertRegex(
            local_target_value["adapter_execution_contract_sha256"], r"^[0-9a-f]{64}$"
        )
        self.assertRegex(
            local_target_value["execution_provenance_sha256"], r"^[0-9a-f]{64}$"
        )
        remote_target = self.invoke("target", target_id="a2a--future-remote--evaluator")
        self.assertEqual(remote_target.returncode, 0, remote_target.stderr)
        remote = json.loads(remote_target.stdout)
        self.assertEqual(remote["remote_runner_id"], "future-a2a-runner")
        self.assertEqual(remote["roles"], ["evaluator"])
        self.assertEqual(remote["auth"], {"type": "none"})

    def test_legacy_subagent_boolean_is_not_a_selectable_cli_candidate(self):
        self.write_integrations(
            [{
                "id": "codex",
                "tool": "codex",
                "model_family": "codex",
                "subagent": True,
            }],
            [],
        )

        catalog_result = self.invoke("catalog")
        self.assertEqual(catalog_result.returncode, 0, catalog_result.stderr)
        catalog = json.loads(catalog_result.stdout)
        for role in ("planner", "generator", "evaluator"):
            self.assertNotIn(
                ("codex", "subagent"),
                {(entry["tool"], entry["invocation"]) for entry in catalog["roles"][role]},
            )

        target_result = self.invoke("target", target_id="subagent--codex--planner")
        self.assertEqual(target_result.returncode, 2)
        self.assertIn("not registered", target_result.stderr)

    def test_legacy_dispatch_host_native_subagent_is_internal_not_v2_selectable(self):
        self.write_adapter("generator-cli", "generator")
        self.write_adapter("evaluator-cli", "evaluator")
        self.write_registry(
            [
                {
                    "id": "legacy-host-planner",
                    "roles": ["planner"],
                    "transport": "subagent",
                    "agent_type": "planner-proposal",
                    "model_family": "claude",
                },
                local_agent("generator", "generator", "generator-cli", "generator"),
                local_agent("evaluator", "evaluator", "evaluator-cli", "evaluator"),
            ]
        )

        target_result = self.invoke("target", target_id="legacy-host-planner")
        self.assertEqual(target_result.returncode, 0, target_result.stderr)
        target = json.loads(target_result.stdout)
        self.assertEqual(target["bridge_id"], "host-native")
        self.assertNotIn("bridge_protocol", target)
        self.assertNotIn("session_scope", target)

        catalog_result = self.invoke("catalog")
        self.assertEqual(catalog_result.returncode, 0, catalog_result.stderr)
        catalog = json.loads(catalog_result.stdout)
        self.assertNotIn(
            ("claude-code", "subagent"),
            {(entry["tool"], entry["invocation"]) for entry in catalog["roles"]["planner"]},
        )

        self.write_bindings(
            {
                "planner": {"tool": "claude-code", "invocation": "subagent"},
                "generator": {"tool": "generator-cli", "invocation": "local-cli"},
                "evaluator": {"tool": "evaluator-cli", "invocation": "local-cli"},
            }
        )
        resolution = self.invoke("resolve")
        self.assertEqual(resolution.returncode, 2)
        self.assertIn("planner=claude-code+subagent", resolution.stderr)

    def test_acp_bridge_is_hidden_by_default_but_auto_discovers_roles_after_provider_attestation(self):
        self.write_adapter("future-cli", "future")
        self.write_adapter("other-cli", "other")
        self.write_bridge(
            "future-session",
            strategy="managed-session",
            personas={
                "planner": "planner-proposal",
                "evaluator": "evaluator",
            },
        )
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "capabilities": ["plan", "verify"],
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {
                        "home_dir": "/tmp/future-home",
                        "env_allow": ["FUTURE_TOKEN"],
                    },
                    "timeout_s": 900,
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )
        integrations = json.loads(self.registry.read_text(encoding="utf-8"))
        integrations["integrations"].append(
            {
                "id": "other",
                "tool": "other-cli",
                "model_family": "other",
                "local_cli": {
                    "adapter": "other-cli",
                    "sandbox": {"home_dir": "/tmp/other-home"},
                },
            }
        )
        self.registry.write_text(json.dumps(integrations), encoding="utf-8")
        self.write_bindings(
            {
                "planner": {"tool": "future-cli", "invocation": "subagent"},
                "generator": {"tool": "future-cli", "invocation": "local-cli"},
                "evaluator": {"tool": "other-cli", "invocation": "local-cli"},
            }
        )

        catalog_result = self.invoke("catalog")
        self.assertEqual(catalog_result.returncode, 0, catalog_result.stderr)
        catalog = json.loads(catalog_result.stdout)
        for role in ("planner", "generator", "evaluator"):
            choices = {(entry["tool"], entry["invocation"]) for entry in catalog["roles"][role]}
            self.assertIn(("future-cli", "local-cli"), choices)
            self.assertNotIn(("future-cli", "subagent"), choices)

        hidden = self.invoke("target", target_id="subagent--future--planner")
        self.assertEqual(hidden.returncode, 2)
        self.assertIn("not registered", hidden.stderr)

        candidates = self.candidates_with_attested_strict_provider()
        attested_catalog = TOOL_CATALOG_MODULE.build_catalog(candidates)
        for role in ("planner", "evaluator"):
            self.assertIn(
                ("future-cli", "subagent"),
                {
                    (entry["tool"], entry["invocation"])
                    for entry in attested_catalog["roles"][role]
                },
            )
        self.assertNotIn(
            ("future-cli", "subagent"),
            {
                (entry["tool"], entry["invocation"])
                for entry in attested_catalog["roles"]["generator"]
            },
        )

        target = TOOL_CATALOG_MODULE.resolve_target(candidates, "subagent--future--planner")
        self.assertEqual(target["agent_type"], "planner-proposal")
        self.assertEqual(target["adapter"], "future-cli")
        self.assertEqual(target["sandbox"], {
            "home_dir": "/tmp/future-home",
            "env_allow": ["FUTURE_TOKEN"],
        })
        self.assertEqual(target["timeout_s"], TOOL_CATALOG_MODULE.VM_V1_MAX_TASK_SECONDS)
        self.assertEqual(target["bridge_id"], "future-session")
        self.assertEqual(target["bridge_strategy"], "managed-session")
        self.assertEqual(target["session_scope"], "same-session")
        self.assertEqual(target["bridge_protocol"], {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp"],
            "request_delivery": "stdin",
            "response_format": "json",
        })
        self.assertEqual(target["bridge_provider_id"], "fixture-vm-provider")
        self.assertEqual(target["bridge_provider_kind"], "vm-v1")
        self.assertEqual(target["bridge_provider_contract_sha256"], "a" * 64)
        self.assertRegex(target["adapter_execution_contract_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(target["execution_provenance_sha256"], r"^[0-9a-f]{64}$")
        resolved = TOOL_CATALOG_MODULE.resolve(
            candidates, TOOL_CATALOG_MODULE.load_bindings(self.bindings)
        )
        planner = resolved["planner"]
        assert planner is not None
        self.assertEqual(
            planner["execution_provenance_sha256"],
            target["execution_provenance_sha256"],
        )

        # A protocol-compatible manifest is not enough. The installed provider
        # must attest the exact CLI command it can execute.
        kimi_only = self.candidates_with_attested_strict_provider(tool="kimi")
        kimi_only_catalog = TOOL_CATALOG_MODULE.build_catalog(kimi_only)
        for role in ("planner", "evaluator"):
            self.assertNotIn(
                ("future-cli", "subagent"),
                {
                    (entry["tool"], entry["invocation"])
                    for entry in kimi_only_catalog["roles"][role]
                },
            )

    def test_deliverable_channels_default_override_and_fail_closed(self):
        self.write_adapter("future-cli", "future")
        self.write_bridge("future-session", deliverable_channels={"planner": "terminal-message"})
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        candidates = self.candidates_with_attested_strict_provider()
        planner = TOOL_CATALOG_MODULE.resolve_target(candidates, "subagent--future--planner")
        self.assertEqual(planner["deliverable_channel"], "terminal-message")
        evaluator = TOOL_CATALOG_MODULE.resolve_target(candidates, "subagent--future--evaluator")
        self.assertEqual(evaluator["deliverable_channel"], "file")
        # The channel changes the execution path, so it must change provenance.
        self.assertNotEqual(
            planner["execution_provenance_sha256"], evaluator["execution_provenance_sha256"]
        )

        for bad in (
            {"planner": "carrier-pigeon"},
            {"generator": "file"},
            "terminal-message",
        ):
            with self.subTest(bad=bad):
                self.write_bridge("future-session", deliverable_channels=bad)  # type: ignore[arg-type]
                with self.assertRaises(TOOL_CATALOG_MODULE.ToolCatalogError):
                    self.candidates_with_attested_strict_provider()

    def test_verified_external_bridge_is_hidden_without_a_strict_provider(self):
        self.write_adapter("future-cli", "future")
        self.write_bridge("future-session")
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        self.assertIsNone(TOOL_CATALOG_MODULE.external_same_session_bridge_provider())
        candidates = TOOL_CATALOG_MODULE.candidates_from_registry(
            self.registry, self.adapters, self.bridges
        )
        catalog = TOOL_CATALOG_MODULE.build_catalog(candidates)
        with self.assertRaisesRegex(TOOL_CATALOG_MODULE.ToolCatalogError, "not registered"):
            TOOL_CATALOG_MODULE.resolve_target(candidates, "subagent--future--planner")

        for role in ("planner", "generator", "evaluator"):
            choices = {
                (entry["tool"], entry["invocation"])
                for entry in catalog["roles"][role]
            }
            self.assertIn(("future-cli", "local-cli"), choices)
            self.assertNotIn(("future-cli", "subagent"), choices)

    def test_invalid_strict_provider_observation_fails_closed(self):
        self.write_adapter("future-cli", "future")
        self.write_bridge("future-session")
        self.write_integrations(
            [
                {
                    "id": "future",
                    "tool": "future-cli",
                    "model_family": "future",
                    "local_cli": {
                        "adapter": "future-cli",
                        "sandbox": {"home_dir": "/tmp/future-home"},
                    },
                    "subagent": {"bridge": "future-session"},
                }
            ],
            [],
        )
        cases = (
            (
                TOOL_CATALOG_MODULE.StrictExternalBridgeProvider(
                    id="fixture-vm-provider", kind="vm-v1", contract_sha256="A" * 64
                ),
                "contract_sha256",
            ),
            (
                TOOL_CATALOG_MODULE.StrictExternalBridgeProvider(
                    id="fixture-seatbelt-provider", kind="seatbelt-v1", contract_sha256="a" * 64
                ),
                "provider kind",
            ),
            (
                TOOL_CATALOG_MODULE.StrictExternalBridgeProvider(
                    id="fixture-vm-provider", kind="vm-v1", contract_sha256="a" * 64
                ),
                "supported routes",
            ),
        )
        for invalid, expected in cases:
            with self.subTest(expected=expected), mock.patch.object(
                TOOL_CATALOG_MODULE,
                "external_same_session_bridge_provider",
                return_value=invalid,
            ):
                with self.assertRaisesRegex(TOOL_CATALOG_MODULE.ToolCatalogError, expected):
                    TOOL_CATALOG_MODULE.candidates_from_registry(
                        self.registry, self.adapters, self.bridges
                    )

    def test_malformed_external_bridge_is_rejected_before_host_capability_downgrade(self):
        self.write_adapter("future-cli", "future")
        self.write_bridge("future-session", protocol_kind="unpublished-native-agent/v1")
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        with self.assertRaisesRegex(TOOL_CATALOG_MODULE.ToolCatalogError, "not published"):
            TOOL_CATALOG_MODULE.candidates_from_registry(
                self.registry, self.adapters, self.bridges
            )

    def test_execution_provenance_hashes_adapter_and_bridge_semantics_but_not_comments(self):
        self.write_adapter("future-cli", "future")
        self.write_bridge("future-session")
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        def target():
            candidates = self.candidates_with_attested_strict_provider()
            return TOOL_CATALOG_MODULE.resolve_target(candidates, "subagent--future--planner")

        baseline = target()
        bridge_path = self.bridges / "future-session.json"
        adapter_path = self.adapters / "future-cli.json"
        bridge = json.loads(bridge_path.read_text(encoding="utf-8"))
        bridge["_comment"] = "operator-facing bridge note"
        bridge_path.write_text(json.dumps(bridge), encoding="utf-8")
        self.assertEqual(target()["execution_provenance_sha256"], baseline["execution_provenance_sha256"])

        adapter_value = json.loads(adapter_path.read_text(encoding="utf-8"))
        adapter_value["_comment"] = "operator-facing adapter note"
        adapter_value["display_name"] = "Future CLI"
        adapter_path.write_text(json.dumps(adapter_value), encoding="utf-8")
        comment_only = target()
        self.assertEqual(
            comment_only["execution_provenance_sha256"],
            baseline["execution_provenance_sha256"],
        )
        self.assertEqual(
            comment_only["adapter_execution_contract_sha256"],
            baseline["adapter_execution_contract_sha256"],
        )

        bridge["strategy"] = "managed-session"
        bridge_path.write_text(json.dumps(bridge), encoding="utf-8")
        bridge_changed = target()
        self.assertNotEqual(
            bridge_changed["execution_provenance_sha256"],
            baseline["execution_provenance_sha256"],
        )

        bridge["strategy"] = "native-session"
        bridge_path.write_text(json.dumps(bridge), encoding="utf-8")
        adapter_value["env_allowlist_extra"] = ["FUTURE_TOKEN"]
        adapter_path.write_text(json.dumps(adapter_value), encoding="utf-8")
        adapter_changed = target()
        self.assertNotEqual(
            adapter_changed["adapter_execution_contract_sha256"],
            baseline["adapter_execution_contract_sha256"],
        )
        self.assertNotEqual(
            adapter_changed["execution_provenance_sha256"],
            baseline["execution_provenance_sha256"],
        )

    def test_bridge_manifest_requires_verified_local_cli_policy(self):
        self.write_bridge("future-session")
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("requires local_cli", result.stderr)

    def test_bridge_manifest_rejects_unverified_or_unpublished_protocol(self):
        self.write_adapter("future-cli", "future")
        integration = {
            "id": "future",
            "tool": "future-cli",
            "model_family": "future",
            "local_cli": {
                "adapter": "future-cli",
                "sandbox": {"home_dir": "/tmp/future-home"},
            },
            "subagent": {"bridge": "future-session"},
        }
        cases = (
            ("unverified", {"verified": False}, "not verified"),
            ("wrong persona", {"personas": {"planner": "evaluator"}}, "framework role contract"),
            (
                "dormant app server",
                {"protocol_kind": "app-server-native-agent/v1"},
                "not published",
            ),
            (
                "unknown protocol",
                {"protocol_kind": "unreviewed-native-agent/v1"},
                "not published",
            ),
        )
        for label, bridge_args, expected in cases:
            with self.subTest(label=label):
                self.write_bridge("future-session", **bridge_args)
                self.write_integrations([integration], [])
                result = self.invoke("catalog")
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn(expected, result.stderr)

    def test_bridge_manifest_command_must_match_its_verified_adapter(self):
        self.write_adapter("future-cli", "future")
        self.write_bridge("future-session", command=["other-cli", "acp"])
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("must exactly match", result.stderr)

    def test_bridge_adapter_rejects_unpublished_command_even_when_acp_is_bound(self):
        self.write_adapter("future-cli", "future")
        adapter_path = self.adapters / "future-cli.json"
        raw_adapter = json.loads(adapter_path.read_text(encoding="utf-8"))
        raw_adapter["bridge_commands"] = {
            "acp-native-agent/v1": ["future-cli", "acp"],
            "app-server-native-agent/v1": ["future-cli", "app-server"],
        }
        adapter_path.write_text(json.dumps(raw_adapter), encoding="utf-8")
        self.write_bridge("future-session")
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
                "subagent": {"bridge": "future-session"},
            }],
            [],
        )

        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("unpublished protocol", result.stderr)

    def test_shipped_kimi_protocol_manifest_stays_hidden_without_provider_and_codex_stays_local_cli(self):
        bridge_id = "kimi-acp-native-agent"
        source = HERE / "transports" / "bridges" / f"{bridge_id}.json"
        self.assertTrue(source.is_file(), f"missing shipped bridge manifest: {source}")
        (self.bridges / source.name).write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        manifest = json.loads(source.read_text(encoding="utf-8"))
        self.assertEqual(
            manifest["personas"],
            {
                "planner": "planner-proposal",
                "generator": "generator-restricted",
                "evaluator": "evaluator",
            },
        )
        self.write_adapter("codex", "codex")
        self.write_adapter("kimi", "kimi")
        self.write_integrations(
            [
                {
                    "id": "codex",
                    "tool": "codex",
                    "model_family": "codex",
                    "local_cli": {
                        "adapter": "codex",
                        "sandbox": {"home_dir": "/tmp/codex-home"},
                    },
                },
                {
                    "id": "kimi",
                    "tool": "kimi",
                    "model_family": "kimi",
                    "local_cli": {
                        "adapter": "kimi",
                        "sandbox": {"home_dir": "/tmp/kimi-home"},
                    },
                    "subagent": {"bridge": "kimi-acp-native-agent"},
                },
            ],
            [],
        )

        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = json.loads(result.stdout)
        for role in ("planner", "generator", "evaluator"):
            choices = {(entry["tool"], entry["invocation"]) for entry in catalog["roles"][role]}
            self.assertIn(("codex", "local-cli"), choices)
            self.assertNotIn(("codex", "subagent"), choices)
            self.assertIn(("kimi", "local-cli"), choices)
            self.assertNotIn(("kimi", "subagent"), choices)
        hidden = self.invoke("target", target_id="subagent--kimi--planner")
        self.assertEqual(hidden.returncode, 2)

        candidates = self.candidates_with_attested_strict_provider(tool="kimi")
        attested_catalog = TOOL_CATALOG_MODULE.build_catalog(candidates)
        for role in ("planner", "generator", "evaluator"):
            choices = {
                (entry["tool"], entry["invocation"])
                for entry in attested_catalog["roles"][role]
            }
            self.assertIn(("kimi", "subagent"), choices)
            self.assertNotIn(("codex", "subagent"), choices)
        kimi_target = TOOL_CATALOG_MODULE.resolve_target(
            candidates, "subagent--kimi--planner"
        )
        self.assertEqual(kimi_target["bridge_protocol"]["kind"], "acp-native-agent/v1")
        self.assertEqual(kimi_target["bridge_provider_id"], "fixture-vm-provider")
        self.assertEqual(kimi_target["native_agent_type"], "plan")
        self.assertEqual(kimi_target["deliverable_channel"], "terminal-message")
        self.assertRegex(kimi_target["adapter_execution_contract_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(kimi_target["execution_provenance_sha256"], r"^[0-9a-f]{64}$")

    def test_integrations_reject_a2a_target_without_local_cli_profile(self):
        self.write_integrations(
            [{
                "id": "subagent-only",
                "tool": "claude-code",
                "model_family": "claude",
                "subagent": True,
            }],
            [{
                "id": "invalid-remote",
                "integration_id": "subagent-only",
                "remote_runner_id": "invalid-runner",
                "endpoint": "https://invalid.example/a2a",
            }],
        )
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("must provide local_cli", result.stderr)

    def test_integrations_reject_invalid_declared_local_cli(self):
        self.write_integrations(
            [{
                "id": "subagent-only",
                "tool": "claude-code",
                "model_family": "claude",
                "subagent": True,
                "local_cli": False,
            }],
            [],
        )
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("local_cli must be an object", result.stderr)

    def test_integrations_reject_overlong_integration_or_target_ids(self):
        self.write_adapter("future-cli", "future")
        overlong = "x" * 65
        self.write_integrations(
            [{
                "id": overlong,
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
            }],
            [],
        )
        integration_result = self.invoke("catalog")
        self.assertEqual(integration_result.returncode, 2)
        self.assertIn("integration", integration_result.stderr)

        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
            }],
            [{
                "id": overlong,
                "integration_id": "future",
                "remote_runner_id": "future-runner",
                "endpoint": "https://future.invalid/a2a",
            }],
        )
        target_result = self.invoke("catalog")
        self.assertEqual(target_result.returncode, 2)
        self.assertIn("a2a_targets", target_result.stderr)

    def test_integrations_reject_a2a_target_without_remote_runner_identity(self):
        self.write_adapter("future-cli", "future")
        self.write_integrations(
            [{
                "id": "future",
                "tool": "future-cli",
                "model_family": "future",
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
            }],
            [{
                "id": "future-remote",
                "integration_id": "future",
                "endpoint": "https://future.invalid/a2a",
            }],
        )
        result = self.invoke("catalog")
        self.assertEqual(result.returncode, 2)
        self.assertIn("remote_runner_id", result.stderr)

    def test_catalog_text_and_capability_bounds_are_explicit(self):
        self.write_adapter("future-cli", "future")

        def registry(model_family="future", label=None, capabilities=None, endpoint_value=None):
            integration = {
                "id": "future",
                "tool": "future-cli",
                "model_family": model_family,
                "local_cli": {
                    "adapter": "future-cli",
                    "sandbox": {"home_dir": "/tmp/future-home"},
                },
            }
            if label is not None:
                integration["label"] = label
            if capabilities is not None:
                integration["capabilities"] = capabilities
            targets = []
            if endpoint_value is not None:
                targets.append({
                    "id": "future-remote",
                    "integration_id": "future",
                    "remote_runner_id": "future-runner",
                    "endpoint": endpoint_value,
                })
            return [integration], targets

        cases = (
            ("model family length", *registry(model_family="x" * 129)),
            ("model family control", *registry(model_family="future\nfamily")),
            ("model family edge control", *registry(model_family="\nfuture")),
            ("label length", *registry(label="x" * 129)),
            ("label control", *registry(label="Future\nCLI")),
            ("capability format", *registry(capabilities=["unsafe capability"])),
            ("capability length", *registry(capabilities=["x" * 65])),
            ("endpoint length", *registry(endpoint_value="https://example.invalid/" + "x" * 2025)),
            ("endpoint control", *registry(endpoint_value="https://example.invalid/a2a\nnext")),
            ("endpoint edge control", *registry(endpoint_value="\nhttps://example.invalid/a2a")),
        )
        for label, integrations, targets in cases:
            with self.subTest(label=label):
                self.write_integrations(integrations, targets)
                result = self.invoke("catalog")
                self.assertEqual(result.returncode, 2, result.stderr)

    def test_catalog_rejects_control_characters_in_sandbox_env_set_values(self):
        self.write_adapter("future-cli", "future")
        for value in ("token\x00ZDOTDIR=/tmp/escape", "token\nnext", "token\x7fnext"):
            with self.subTest(value=repr(value)):
                self.write_integrations(
                    [{
                        "id": "future",
                        "tool": "future-cli",
                        "model_family": "future",
                        "local_cli": {
                            "adapter": "future-cli",
                            "sandbox": {
                                "home_dir": "/tmp/future-home",
                                "env_set": {"FIXTURE_TOKEN": value},
                            },
                        },
                    }],
                    [],
                )
                result = self.invoke("catalog")
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("must not contain control characters", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
