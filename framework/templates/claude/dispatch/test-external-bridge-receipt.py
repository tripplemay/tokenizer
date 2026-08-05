#!/usr/bin/env python3
"""Focused tests for provider-attested external subagent receipt validation."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import datetime as dt
from pathlib import Path
from typing import Optional


HERE = Path(__file__).resolve().parent
VALIDATOR_PATH = HERE / "validate-external-bridge-receipt.py"
TASK = "external-receipt-fixture-001"
BATCH = "BL-EXTERNAL-RECEIPT"
REF = "a" * 40
FEATURE = "F001"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")


def load_validator():
    spec = importlib.util.spec_from_file_location("external_bridge_receipt_validator", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load external bridge receipt validator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ExternalBridgeReceiptValidatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = load_validator()

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="external-bridge-receipt-")
        self.root = Path(self.temp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        self.state = self.project / ".harness-dispatch"
        self.state.mkdir()
        self.runs = self.root / "provider-runs"
        self.worktree = self.runs / f"{TASK}-{'a' * 24}" / "copyout"
        self.worktree.mkdir(parents=True)
        self.configure_role("generator")

    def configure_role(self, role: str) -> None:
        self.role = role
        native_type = {"planner": "plan", "generator": "coder", "evaluator": "explore"}[role]
        schema = {
            "planner": ".claude/dispatch/planner-proposal.schema.json",
            "generator": ".claude/dispatch/generator-handoff.schema.json",
            "evaluator": ".claude/autonomous/verdict-artifact.schema.json",
        }[role]
        artifact_rel = {
            "planner": f"docs/test-reports/planner-proposal-{TASK}.json",
            "generator": f"docs/test-reports/generator-handoff-{TASK}.json",
            "evaluator": f"docs/test-reports/{BATCH}-verdict.json",
        }[role]
        self.artifact_rel = artifact_rel
        self.handoff = self.worktree / artifact_rel
        write_json(
            self.handoff,
            {
                "fixture_role": role,
                "waiting": None,
            },
        )
        self.envelope = self.state / f"envelope-{TASK}.json"
        self.deliverable = {
            "artifact": artifact_rel,
            "schema": schema,
            "commit_to": None,
        }
        write_json(
            self.envelope,
            {
                "task_id": TASK,
                "contract_version": "harness/1.1",
                "batch": BATCH,
                "role": role,
                "repo": {"url": ".", "ref": REF},
                "spec": None,
                "features": [FEATURE] if role == "generator" else [],
                "l2_authorized": False,
                "contract": "fixture",
                "deliverable": self.deliverable,
            },
        )
        self.active_role = {
            "agent_id": f"fixture-{role}",
            "tool": "fixture-cli",
            "invocation": "subagent",
            "model_family": "fixture",
            "priority": 1,
            "execution_provenance_sha256": "1" * 64,
        }
        self.active_role_raw = json.dumps(self.active_role, sort_keys=True, separators=(",", ":"))
        self.active_target = {
            "target_id": self.active_role["agent_id"],
            "integration_id": "fixture-integration",
            "tool": self.active_role["tool"],
            "invocation": "subagent",
            "model_family": self.active_role["model_family"],
            "priority": self.active_role["priority"],
            "roles": [role],
            "adapter": "fixture",
            "sandbox": {"home_dir": "/tmp/fixture"},
            "timeout_s": 60,
            "agent_type": {
                "planner": "planner-proposal",
                "generator": "generator-restricted",
                "evaluator": "evaluator",
            }[role],
            "native_agent_type": native_type,
            "bridge_id": "fixture-acp",
            "bridge_strategy": "session-bridge-v1",
            "session_scope": "same-session",
            "bridge_protocol": {
                "kind": "acp-native-agent/v1",
                "command": ["fixture", "acp"],
                "request_delivery": "stdin",
                "response_format": "json",
            },
            "bridge_provider_id": "harness-vm-v1",
            "bridge_provider_kind": "vm-v1",
            "bridge_provider_contract_sha256": "b" * 64,
            "adapter_execution_contract_sha256": "a" * 64,
            "capabilities": [],
            "execution_provenance_sha256": self.active_role["execution_provenance_sha256"],
        }
        self.active_target_raw = json.dumps(self.active_target, sort_keys=True, separators=(",", ":"))
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        iso = lambda value: value.isoformat().replace("+00:00", "Z")
        self.attestation = {
            "version": "harness/external-bridge-provider-attestation/1",
            "provider_id": "harness-vm-v1",
            "provider_kind": "vm-v1",
            "contract_sha256": "b" * 64,
            "phase": "launch",
            "nonce_sha256": "c" * 64,
            "issued_at": iso(now - dt.timedelta(minutes=1)),
            "expires_at": iso(now + dt.timedelta(minutes=4)),
            "image_sha256": "d" * 64,
            "runner_sha256": "e" * 64,
            "cli_bundle_sha256": "f" * 64,
            "broker_policy_sha256": "0" * 64,
            "target_provenance_sha256": self.active_role["execution_provenance_sha256"],
            "envelope_sha256": hashlib.sha256(self.envelope.read_bytes()).hexdigest(),
        }
        bridge = {
            "bridge_id": "fixture-acp",
            "bridge_strategy": "session-bridge-v1",
            "bridge_kind": "acp-native-agent/v1",
            "session_scope": "same-session",
            "session_id_sha256": "2" * 64,
            "nonce_sha256": self.attestation["nonce_sha256"],
            "child_call_id_sha256": "3" * 64,
            "subagent_type": native_type,
            "terminal_status": "completed",
            "provider_launch_attestation_sha256": self.validator.canonical_attestation_sha256(self.attestation),
            "artifact_sha256": hashlib.sha256(self.handoff.read_bytes()).hexdigest(),
            "provider_launch_attestation": self.attestation,
        }
        self.meta = self.state / f"run-meta-{TASK}.json"
        write_json(
            self.meta,
            {
                "task_id": TASK,
                "agent_id": self.active_role["agent_id"],
                "adapter": "fixture",
                "model_family": "fixture",
                "role": role,
                "deliverable": self.deliverable,
                "batch": BATCH,
                "ref": REF,
                "worktree": str(self.worktree),
                "artifact": str(self.handoff),
                "log": str(self.worktree.parent / "provider.log"),
                "envelope_path": str(self.envelope),
                "outcome": "RETURNED",
                "exit_code": 0,
                "duration_s": 1,
                "effective_timeout_s": 60,
                "descriptor_timeout_s": 60,
                "termination_reason": "completed",
                "transport": "subagent",
                "bridge": bridge,
                "source_changes": ["src/generated.txt"] if role == "generator" else [],
            },
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def validate(
        self, active_role_raw: Optional[str] = None, active_target_raw: Optional[str] = None
    ) -> None:
        args = {
            "run_meta_path": self.meta,
            "envelope_path": self.envelope,
            "project_root": self.project,
            "active_role_raw": self.active_role_raw if active_role_raw is None else active_role_raw,
            "active_target_raw": self.active_target_raw if active_target_raw is None else active_target_raw,
            "transient_runs_root": self.runs,
        }
        if self.role == "generator":
            self.validator.validate_generator_subagent_receipt(handoff_path=self.handoff, **args)
        else:
            self.validator.validate_external_subagent_receipt(
                role=self.role, artifact_path=self.handoff, **args
            )

    def test_accepts_the_exact_provider_attested_result(self) -> None:
        self.validate()

    def test_accepts_the_fixed_planner_and_evaluator_artifact_contracts(self) -> None:
        for role in ("planner", "evaluator"):
            with self.subTest(role=role):
                self.configure_role(role)
                self.validate()

    def test_rejects_missing_signed_active_route(self) -> None:
        with self.assertRaisesRegex(
            self.validator.ReceiptValidationError, "signed active Generator subagent route"
        ):
            self.validate("{}")

    def test_rejects_artifact_digest_drift(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        meta["bridge"]["artifact_sha256"] = "0" * 64
        write_json(self.meta, meta)
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "artifact digest"):
            self.validate()

    def test_rejects_target_bridge_fields_that_do_not_match_the_signed_route(self) -> None:
        cases = {
            "bridge_id": "other-acp",
            "bridge_strategy": "other-session-bridge",
            "native_agent_type": "explore",
            "execution_provenance_sha256": "9" * 64,
        }
        for field, value in cases.items():
            with self.subTest(field=field):
                target = json.loads(self.active_target_raw)
                target[field] = value
                with self.assertRaisesRegex(
                    self.validator.ReceiptValidationError,
                    "signed active (Generator )?target|signed active role",
                ):
                    self.validate(active_target_raw=json.dumps(target, sort_keys=True))

    def test_rejects_launch_attestation_for_a_different_envelope(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        attestation = meta["bridge"]["provider_launch_attestation"]
        attestation["envelope_sha256"] = "7" * 64
        meta["bridge"]["provider_launch_attestation_sha256"] = (
            self.validator.canonical_attestation_sha256(attestation)
        )
        write_json(self.meta, meta)
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "supplied envelope bytes"):
            self.validate()

    def test_rejects_an_expired_provider_attestation(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        expired = meta["bridge"]["provider_launch_attestation"]
        expired["issued_at"] = (now - dt.timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
        expired["expires_at"] = (now - dt.timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        meta["bridge"]["provider_launch_attestation_sha256"] = (
            self.validator.canonical_attestation_sha256(expired)
        )
        write_json(self.meta, meta)
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "has expired"):
            self.validate()

    def test_accepts_the_maximum_launch_attestation_lifetime(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        attestation = meta["bridge"]["provider_launch_attestation"]
        issued = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(seconds=1)
        attestation["issued_at"] = issued.isoformat().replace("+00:00", "Z")
        attestation["expires_at"] = (
            issued
            + dt.timedelta(seconds=self.validator.MAX_LAUNCH_ATTESTATION_TTL_SECONDS)
        ).isoformat().replace("+00:00", "Z")
        meta["bridge"]["provider_launch_attestation_sha256"] = (
            self.validator.canonical_attestation_sha256(attestation)
        )
        write_json(self.meta, meta)
        self.validate()

    def test_rejects_a_launch_attestation_lifetime_beyond_the_bound(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        attestation = meta["bridge"]["provider_launch_attestation"]
        issued = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(seconds=1)
        attestation["issued_at"] = issued.isoformat().replace("+00:00", "Z")
        attestation["expires_at"] = (
            issued
            + dt.timedelta(seconds=self.validator.MAX_LAUNCH_ATTESTATION_TTL_SECONDS + 1)
        ).isoformat().replace("+00:00", "Z")
        meta["bridge"]["provider_launch_attestation_sha256"] = (
            self.validator.canonical_attestation_sha256(attestation)
        )
        write_json(self.meta, meta)
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "lifetime is invalid"):
            self.validate()

    def test_rejects_a_generic_subagent_record_without_provider_attestation(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        meta.pop("bridge")
        write_json(self.meta, meta)
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "provider-attested"):
            self.validate()

    def test_rejects_a_copyout_tree_outside_the_account_provider_root(self) -> None:
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        outside = self.project / "fake-copyout"
        outside.mkdir()
        fake_handoff = outside / self.artifact_rel
        write_json(fake_handoff, json.loads(self.handoff.read_text(encoding="utf-8")))
        meta["worktree"] = str(outside)
        meta["artifact"] = str(fake_handoff)
        meta["bridge"]["artifact_sha256"] = hashlib.sha256(fake_handoff.read_bytes()).hexdigest()
        write_json(self.meta, meta)
        self.handoff = fake_handoff
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "account-owned task copy-out"):
            self.validate()

    def test_rejects_a_group_or_world_writable_provider_runs_root(self) -> None:
        self.runs.chmod(0o777)
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "group/world writable"):
            self.validate()

    def test_rejects_run_metadata_outside_project_state(self) -> None:
        outside_meta = self.root / f"run-meta-{TASK}.json"
        write_json(outside_meta, json.loads(self.meta.read_text(encoding="utf-8")))
        self.meta.unlink()
        self.meta = outside_meta
        with self.assertRaisesRegex(self.validator.ReceiptValidationError, "escapes its trusted root"):
            self.validate()


if __name__ == "__main__":
    unittest.main()
