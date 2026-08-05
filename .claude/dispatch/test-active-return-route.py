#!/usr/bin/env python3
"""Focused tests for binding return metadata to the active route."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
VALIDATOR_PATH = HERE / "validate-active-return-route.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("active_return_route_validator", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load active return route validator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ActiveReturnRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = load_validator()

    @staticmethod
    def metadata(transport: str) -> dict[str, object]:
        return {"agent_id": "fixture-generator", "transport": transport}

    @staticmethod
    def active_role(invocation: str) -> dict[str, object]:
        return {"agent_id": "fixture-generator", "invocation": invocation}

    @staticmethod
    def external_target() -> dict[str, object]:
        return {
            "target_id": "fixture-generator",
            "invocation": "subagent",
            "bridge_id": "fixture-acp",
            "bridge_strategy": "session-bridge-v1",
            "bridge_protocol": {"kind": "acp-native-agent/v1"},
            "session_scope": "same-session",
        }

    def test_external_target_rejects_a_forged_local_cli_return(self) -> None:
        with self.assertRaisesRegex(
            self.validator.RouteValidationError,
            "transport does not match the re-verified active target",
        ):
            self.validator.classify_return_route(
                self.metadata("local-cli"),
                self.active_role("subagent"),
                self.external_target(),
            )

    def test_local_target_rejects_a_forged_subagent_return(self) -> None:
        target = {"target_id": "fixture-generator", "invocation": "local-cli"}
        with self.assertRaisesRegex(
            self.validator.RouteValidationError,
            "transport does not match the re-verified active target",
        ):
            self.validator.classify_return_route(
                self.metadata("subagent"), self.active_role("local-cli"), target
            )

    def test_external_target_returns_the_provider_required_route(self) -> None:
        self.assertEqual(
            self.validator.classify_return_route(
                self.metadata("subagent"),
                self.active_role("subagent"),
                self.external_target(),
            ),
            {"route": "external-bridge-subagent", "invocation": "subagent"},
        )

    def test_active_role_and_target_must_name_the_same_agent(self) -> None:
        target = self.external_target()
        target["target_id"] = "other-agent"
        with self.assertRaisesRegex(self.validator.RouteValidationError, "agent"):
            self.validator.classify_return_route(
                self.metadata("subagent"), self.active_role("subagent"), target
            )

    def test_cli_emits_the_authoritative_external_route(self) -> None:
        with tempfile.TemporaryDirectory(prefix="active-return-route-") as temporary:
            meta = Path(temporary) / "run-meta.json"
            meta.write_text(json.dumps(self.metadata("subagent")), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(VALIDATOR_PATH),
                    "--run-meta",
                    str(meta),
                    "--active-role-json",
                    json.dumps(self.active_role("subagent")),
                    "--active-target-json",
                    json.dumps(self.external_target()),
                ],
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["route"], "external-bridge-subagent")


if __name__ == "__main__":
    unittest.main()
