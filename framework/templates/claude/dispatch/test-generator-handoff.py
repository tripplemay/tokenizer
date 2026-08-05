#!/usr/bin/env python3
"""Focused regression fixtures for manual external Generator dispatch."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
HANDOFF_VALIDATOR = HERE / "validate-generator-handoff.sh"
DISPATCH_VALIDATOR = HERE / "validate-dispatch.sh"
GENERATOR_DISPATCH = HERE / "dispatch-generator-handoff.sh"
TASK_ID = "build-fixture-001"
BATCH_ID = "BL-BUILD-FIXTURE"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def generator_envelope(features: list[str] | None = None) -> dict[str, object]:
    return {
        "task_id": TASK_ID,
        "contract_version": "harness/1.1",
        "batch": BATCH_ID,
        "role": "generator",
        "repo": {"url": ".", "ref": "a" * 40},
        "spec": "docs/specs/fixture.md",
        "features": features or ["F001", "F002"],
        "l2_authorized": False,
        "contract": "Implement only the commissioned generator features and return a handoff artifact.",
        "deliverable": {
            "artifact": f"docs/test-reports/generator-handoff-{TASK_ID}.json",
            "schema": ".claude/dispatch/generator-handoff.schema.json",
            "commit_to": None,
        },
    }


def valid_handoff(features: list[str] | None = None) -> dict[str, object]:
    features = features or ["F001", "F002"]
    return {
        "batch_id": BATCH_ID,
        "created_at": "2026-07-31T00:00:00Z",
        "features": [
            {
                "feature_id": feature_id,
                "files_touched": [f"src/{feature_id.lower()}.txt"],
                "commits": [],
                "notes": "Implemented in the sandbox clone.",
            }
            for feature_id in features
        ],
        "l1_ran": {"test": "python -m unittest"},
        "waiting": None,
    }


class GeneratorHandoffValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="generator-handoff-")
        self.root = Path(self.temp.name)
        self.artifact = self.root / "handoff.json"
        self.envelope = self.root / "envelope.json"
        write_json(self.envelope, generator_envelope())

    def tearDown(self) -> None:
        self.temp.cleanup()

    def validate(self, handoff: dict[str, object]) -> subprocess.CompletedProcess[str]:
        write_json(self.artifact, handoff)
        return subprocess.run(
            ["bash", str(HANDOFF_VALIDATOR), str(self.artifact), "--envelope", str(self.envelope)],
            text=True,
            capture_output=True,
        )

    def test_valid_completed_handoff_is_bound_to_envelope_features(self) -> None:
        result = self.validate(valid_handoff())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_uncommissioned_or_missing_features_and_unsafe_paths(self) -> None:
        unexpected = valid_handoff(["F001", "F003"])
        result = self.validate(unexpected)
        self.assertEqual(result.returncode, 2)
        self.assertIn("was not commissioned", result.stderr)
        self.assertIn("missing commissioned", result.stderr)

        unsafe = valid_handoff()
        unsafe["features"][0]["files_touched"] = ["../outside.txt"]  # type: ignore[index]
        result = self.validate(unsafe)
        self.assertEqual(result.returncode, 2)
        self.assertIn("must not contain", result.stderr)

    def test_waiting_handoff_can_return_a_bounded_partial_list(self) -> None:
        waiting = valid_handoff(["F001"])
        waiting["waiting"] = "adjudication"
        waiting["waiting_detail"] = "The feature needs a product decision."
        result = self.validate(waiting)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_receipt_revalidates_handoff_against_its_exact_envelope_path(self) -> None:
        handoff = valid_handoff(["F001", "F003"])
        write_json(self.artifact, handoff)
        meta = self.root / "run-meta.json"
        write_json(
            meta,
            {
                "task_id": TASK_ID,
                "agent_id": "fixture-generator",
                "model_family": "fixture",
                "batch": BATCH_ID,
                "ref": "a" * 40,
                "role": "generator",
                "deliverable": generator_envelope()["deliverable"],
                "artifact": str(self.artifact),
                "envelope_path": str(self.envelope),
                "worktree": str(self.root),
                "outcome": "RETURNED",
                "exit_code": 0,
                "duration_s": 1,
                "transport": "local-cli",
            },
        )
        result = subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "receipt", str(meta)],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        receipts = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        self.assertEqual(len(receipts), 1, result.stdout)
        self.assertEqual(receipts[0]["state"], "ARTIFACT_INVALID")
        self.assertEqual(receipts[0]["artifact_path"], str(self.artifact))
        self.assertEqual(
            Path(receipts[0]["run_meta_path"]).resolve(),
            meta.resolve(),
        )
        self.assertEqual(
            Path(receipts[0]["envelope_path"]).resolve(),
            self.envelope.resolve(),
        )
        self.assertEqual(receipts[0]["worktree_path"], str(self.root))

    def test_host_native_subagent_receipt_preserves_legacy_compatibility(self) -> None:
        write_json(self.artifact, valid_handoff())
        meta = self.root / "run-meta-subagent.json"
        write_json(
            meta,
            {
                "task_id": TASK_ID,
                "agent_id": "fixture-generator",
                "model_family": "fixture",
                "batch": BATCH_ID,
                "ref": "a" * 40,
                "role": "generator",
                "deliverable": generator_envelope()["deliverable"],
                "artifact": str(self.artifact),
                "envelope_path": str(self.envelope),
                "worktree": str(self.root),
                "outcome": "RETURNED",
                "exit_code": 0,
                "duration_s": 1,
                "transport": "subagent",
            },
        )
        result = subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "receipt", str(meta)],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt["state"], "COMPLETED")

        # A raw `bridge` record is an external-route claim. It cannot use the
        # host-native compatibility path without a matching signed target.
        returned = json.loads(meta.read_text(encoding="utf-8"))
        returned["bridge"] = {}
        write_json(meta, returned)
        result = subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "receipt", str(meta)],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt["state"], "ARTIFACT_INVALID")
        self.assertIn("active target", receipt["reason"])

    def test_external_generator_target_rejects_run_meta_role_drift(self) -> None:
        write_json(self.artifact, valid_handoff())
        meta = self.root / "run-meta-external-role-drift.json"
        write_json(
            meta,
            {
                "task_id": TASK_ID,
                "agent_id": "fixture-generator",
                "model_family": "fixture",
                "batch": BATCH_ID,
                "ref": "a" * 40,
                "role": "unknown",
                "deliverable": generator_envelope()["deliverable"],
                "artifact": str(self.artifact),
                "envelope_path": str(self.envelope),
                "worktree": str(self.root),
                "outcome": "RETURNED",
                "exit_code": 0,
                "duration_s": 1,
                "transport": "subagent",
            },
        )
        active_role = {"agent_id": "fixture-generator", "invocation": "subagent"}
        active_target = {
            "target_id": "fixture-generator",
            "invocation": "subagent",
            "bridge_id": "fixture-acp",
            "bridge_strategy": "session-bridge-v1",
            "bridge_protocol": {"kind": "acp-native-agent/v1"},
            "session_scope": "same-session",
        }
        result = subprocess.run(
            [
                "bash", str(DISPATCH_VALIDATOR), "receipt", str(meta),
                "--expected-envelope", str(self.envelope),
                "--active-role-json", json.dumps(active_role),
                "--active-target-json", json.dumps(active_target),
                "--project-root", str(self.root),
            ],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt["state"], "ARTIFACT_INVALID")
        self.assertIn("role does not match", receipt["reason"])


class ManualGeneratorDispatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="manual-generator-dispatch-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "project"
        self.repo.mkdir()
        subprocess.run(["git", "-C", str(self.repo), "init", "-q"], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.email", "fixture@example.invalid"],
            check=True,
        )
        subprocess.run(["git", "-C", str(self.repo), "config", "user.name", "fixture"], check=True)
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        (self.repo / "docs" / "specs").mkdir(parents=True)
        (self.repo / "docs" / "specs" / "fixture.md").write_text("# Fixture\n", encoding="utf-8")
        self.adapters = self.root / "adapters"
        self.adapters.mkdir()
        self.safe_home = self.root / "safe-home"
        self.safe_home.mkdir()
        self.workroot = self.root / "workroot"
        self.state = self.root / "state"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_build_state(self, assignment: object) -> None:
        write_json(
            self.repo / "progress.json",
            {
                "status": "building",
                "current_sprint": BATCH_ID,
                "docs": {"spec": "docs/specs/fixture.md"},
                "role_assignments": assignment,
            },
        )
        write_json(
            self.repo / "features.json",
            {
                "sprint": BATCH_ID,
                "features": [
                    {
                        "id": "F001",
                        "title": "Generator fixture",
                        "executor": "generator",
                        "status": "pending",
                        "acceptance": "A fixture file is added.",
                    },
                    {
                        "id": "F002",
                        "title": "Evaluator fixture",
                        "executor": "evaluator",
                        "status": "pending",
                        "acceptance": "An evaluation report exists.",
                    },
                    {
                        "id": "F003",
                        "title": "Later generator fixture",
                        "executor": "generator",
                        "status": "pending",
                        "acceptance": "A later fixture is intentionally queued.",
                    },
                ],
            },
        )

    def commit_fixture(self) -> str:
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-qm", "fixture"], check=True)
        return subprocess.check_output(["git", "-C", str(self.repo), "rev-parse", "HEAD"], text=True).strip()

    def write_local_cli_registry(self) -> Path:
        fake = self.root / "fake-generator.py"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json\n"
            "import os\n"
            "from pathlib import Path\n"
            "envelope = json.load(open(os.environ['HARNESS_ENVELOPE'], encoding='utf-8'))\n"
            "feature_id = envelope['features'][0]\n"
            "Path('src').mkdir(exist_ok=True)\n"
            "changed_path = f'src/{feature_id.lower()}.txt'\n"
            "Path(changed_path).write_text('generated\\n', encoding='utf-8')\n"
            "artifact = Path(os.environ['HARNESS_ARTIFACT'])\n"
            "artifact.parent.mkdir(parents=True, exist_ok=True)\n"
            "json.dump({\n"
            "  'batch_id': os.environ['HARNESS_BATCH'],\n"
            "  'created_at': '2026-07-31T00:00:00Z',\n"
            "  'features': [{'feature_id': feature_id, 'files_touched': [changed_path], 'commits': []}],\n"
            "  'l1_ran': {'test': 'fixture'}, 'waiting': None\n"
            "}, artifact.open('w', encoding='utf-8'))\n",
            encoding="utf-8",
        )
        fake.chmod(0o755)
        write_json(
            self.adapters / "fixture.json",
            {
                "name": "fixture",
                "model_family": "fixture",
                "argv": [sys.executable, str(fake)],
                "envelope_delivery": "stdin",
                "_verified": True,
                "artifact_relpath": "ignored.json",
            },
        )
        registry = self.repo / ".agents-registry.json"
        write_json(
            registry,
            {
                "version": "dispatch/1",
                "agents": [
                    {
                        "id": "fixture-generator",
                        "roles": ["generator"],
                        "transport": "local-cli",
                        "adapter": "fixture",
                        "model_family": "fixture",
                        "constraints": {"l2": False, "write_src": True, "push": False},
                        "sandbox": {"home_dir": str(self.safe_home), "env_allow": []},
                        "timeout_s": 60,
                    }
                ],
            },
        )
        return registry

    def run_wrapper(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "bash",
                str(GENERATOR_DISPATCH),
                "--task-id",
                TASK_ID,
                "--registry",
                ".agents-registry.json",
                "--state",
                str(self.state),
                "--workroot",
                str(self.workroot),
                "--adapters",
                str(self.adapters),
                *extra,
            ],
            cwd=self.repo,
            text=True,
            capture_output=True,
        )

    def resolve_generator_context(
        self, descriptor: dict[str, object]
    ) -> dict[str, object]:
        """Exercise the script's route/context block with a fixed catalog reply."""
        dispatch_dir = self.root / "context-dispatch"
        dispatch_dir.mkdir()
        catalog = dispatch_dir / "tool-catalog.py"
        catalog.write_text(
            "import json\n"
            f"print({json.dumps(json.dumps(descriptor))})\n",
            encoding="utf-8",
        )
        progress = self.repo / "progress.json"
        features = self.repo / "features.json"
        registry = self.repo / ".agents-registry.json"
        output = self.root / "generator-context.json"
        source = GENERATOR_DISPATCH.read_text(encoding="utf-8")
        block_anchor = source.index('CONTEXT="$(mktemp)"')
        block_start = source.index("<<'PY'\n", block_anchor) + len("<<'PY'\n")
        block_end = source.index("\nPY\nthen", block_start)
        block = source[block_start:block_end]
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                block,
                str(progress),
                str(features),
                str(registry),
                str(self.repo),
                str(output),
                "",
                str(dispatch_dir),
                str(self.adapters),
            ],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(output.read_text(encoding="utf-8"))

    def test_local_cli_receives_fixed_envelope_and_returns_uncommitted_handoff(self) -> None:
        self.write_build_state({"generator": "fixture-generator"})
        self.write_local_cli_registry()
        ref = self.commit_fixture()

        result = self.run_wrapper("--deadline-s", "60")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result_json = json.loads(result.stdout)
        self.assertEqual(result_json["receipt"]["state"], "COMPLETED")
        self.assertEqual(result_json["feature_ids"], ["F001"])
        self.assertIn("return validation", result_json["next_action"])
        run_meta = json.loads(Path(result_json["run_meta_path"]).read_text())
        self.assertEqual(run_meta["transport"], "local-cli")

        envelope = json.loads((self.state / f"envelope-{TASK_ID}.json").read_text())
        self.assertEqual(envelope["role"], "generator")
        self.assertEqual(envelope["repo"]["ref"], ref)
        self.assertFalse(envelope["l2_authorized"])
        self.assertEqual(envelope["features"], ["F001"])
        self.assertEqual(
            envelope["deliverable"]["schema"],
            ".claude/dispatch/generator-handoff.schema.json",
        )
        self.assertIsNone(envelope["deliverable"]["commit_to"])

        handoff_path = Path(result_json["handoff_path"])
        self.assertTrue(handoff_path.is_file())
        self.assertTrue((handoff_path.parents[2] / "src" / "f001.txt").is_file())
        self.assertFalse((self.repo / "src" / "f001.txt").exists())
        self.assertEqual(
            subprocess.run(["git", "-C", str(self.repo), "diff", "--quiet"]).returncode,
            0,
        )

    def test_external_bridge_route_keeps_full_generator_context(self) -> None:
        self.write_build_state({"generator": "fixture-external"})
        self.write_local_cli_registry()
        context = self.resolve_generator_context(
            {
                "target_id": "fixture-external",
                "roles": ["generator"],
                "invocation": "subagent",
                "agent_type": "generator-restricted",
                "bridge_id": "fixture-acp",
                "bridge_strategy": "session-bridge-v1",
                "bridge_protocol": {
                    "kind": "acp-native-agent/v1",
                    "command": ["fixture", "acp"],
                    "request_delivery": "stdin",
                    "response_format": "json",
                },
                "session_scope": "same-session",
            }
        )
        self.assertEqual(context["route"], "external-bridge-subagent")
        self.assertEqual(context["agent_id"], "fixture-external")
        self.assertEqual(context["batch"], BATCH_ID)
        self.assertEqual(context["spec"], "docs/specs/fixture.md")
        self.assertEqual(context["feature_ids"], ["F001"])
        self.assertEqual(context["agent_type"], "generator-restricted")
        self.assertEqual(context["active_target"]["target_id"], "fixture-external")
        self.assertEqual(
            context["active_target"]["bridge_strategy"], "session-bridge-v1"
        )

    def test_explicit_feature_selects_only_that_pending_generator_feature(self) -> None:
        self.write_build_state({"generator": "fixture-generator"})
        self.write_local_cli_registry()
        self.commit_fixture()

        result = self.run_wrapper("--feature", "F003", "--deadline-s", "60")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result_json = json.loads(result.stdout)
        self.assertEqual(result_json["feature_ids"], ["F003"])
        envelope = json.loads((self.state / f"envelope-{TASK_ID}.json").read_text())
        self.assertEqual(envelope["features"], ["F003"])
        handoff = json.loads(Path(result_json["handoff_path"]).read_text())
        self.assertEqual(handoff["features"][0]["feature_id"], "F003")

    def test_refuses_multi_feature_external_handoff_before_creating_state(self) -> None:
        self.write_build_state({"generator": "fixture-generator"})
        self.write_local_cli_registry()
        self.commit_fixture()

        result = self.run_wrapper("--feature", "F001", "--feature", "F003")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("exactly one --feature", result.stderr)
        self.assertFalse(self.state.exists())

    def test_default_and_subagent_routes_do_not_fall_back_to_coordinator_implementation(self) -> None:
        self.write_build_state(None)
        write_json(self.repo / ".agents-registry.json", {"version": "dispatch/1", "agents": []})
        self.commit_fixture()
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn("historical local /build path", result.stderr)
        self.assertFalse(self.state.exists())

        self.write_build_state({"generator": "subagent-generator"})
        write_json(
            self.repo / ".agents-registry.json",
            {
                "version": "dispatch/1",
                "agents": [
                    {
                        "id": "subagent-generator",
                        "roles": ["generator"],
                        "transport": "subagent",
                        "agent_type": "generator-restricted",
                        "model_family": "fixture",
                        "constraints": {"l2": False, "write_src": True, "push": True},
                    }
                ],
            },
        )
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn("descriptor.agent_type=generator-restricted", result.stderr)
        self.assertFalse(self.state.exists())

    def test_registry_is_pinned_before_generator_dispatch_state_is_created(self) -> None:
        self.write_build_state({"generator": "fixture-generator"})
        registry = self.write_local_cli_registry()
        self.commit_fixture()
        outside = self.root / "outside-registry.json"
        outside.write_text(registry.read_text(encoding="utf-8"), encoding="utf-8")

        result = self.run_wrapper("--registry", str(outside))
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("registry", result.stderr.lower())
        self.assertFalse(self.state.exists())
        self.assertFalse(self.workroot.exists())

        registry.unlink()
        registry.symlink_to(outside)
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("registry", result.stderr.lower())
        self.assertFalse(self.state.exists())
        self.assertFalse(self.workroot.exists())

    def test_a2a_generator_fails_closed_without_creating_dispatch_state(self) -> None:
        self.write_build_state({"generator": "remote-generator"})
        write_json(
            self.repo / ".agents-registry.json",
            {
                "version": "dispatch/1",
                "agents": [
                    {
                        "id": "remote-generator",
                        "roles": ["generator"],
                        "transport": "a2a",
                        "endpoint": "https://runner.invalid",
                        "model_family": "remote",
                        "constraints": {"l2": False, "write_src": True, "push": False},
                    }
                ],
            },
        )
        self.commit_fixture()
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("fail closed", result.stderr)
        self.assertFalse(self.state.exists())


if __name__ == "__main__":
    unittest.main()
