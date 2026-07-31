#!/usr/bin/env python3
"""Focused regression fixtures for Planner proposal dispatch artifacts."""

from __future__ import annotations

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
PROPOSAL_VALIDATOR = HERE / "validate-planner-proposal.sh"
DISPATCH_VALIDATOR = HERE / "validate-dispatch.sh"
PLANNER_WRAPPER = HERE / "dispatch-planner-proposal.sh"
PLANNER_PREPARE = HERE / "prepare-planner-proposal.sh"
PLANNER_ACCEPT = HERE / "accept-planner-proposal.sh"

TASK_ID = "plan-fixture-001"
BATCH_ID = "BL-PLAN-FIXTURE"
SOURCE_REF = "a" * 40


def valid_proposal() -> dict[str, object]:
    return {
        "proposal_version": "planner-proposal/1",
        "task_id": TASK_ID,
        "batch_id": BATCH_ID,
        "source_ref": SOURCE_REF,
        "kind": "batch_plan",
        "created_at": "2026-07-31T00:00:00Z",
        "summary": "Propose a bounded batch with observable acceptance criteria.",
        "questions": [],
        "spec": {
            "title": "Planner proposal fixture",
            "markdown": "# Planner proposal fixture\\n\\nA bounded implementation plan.",
        },
        "features": [
            {
                "id": "F001",
                "title": "Add the bounded implementation",
                "priority": "high",
                "executor": "generator",
                "acceptance": "The intended behavior is verified by a focused regression test.",
            }
        ],
        "decisions": [],
        "waiting": None,
    }


def planner_envelope() -> dict[str, object]:
    return {
        "task_id": TASK_ID,
        "contract_version": "harness/1.1",
        "batch": BATCH_ID,
        "role": "planner",
        "repo": {"url": "/tmp/planner-fixture", "ref": SOURCE_REF},
        "spec": None,
        "features": [],
        "l2_authorized": False,
        "contract": (
            "Read the immutable repository snapshot and return only a structured "
            "Planner proposal. Do not write project state or code."
        ),
        "deliverable": {
            "artifact": f"docs/test-reports/planner-proposal-{TASK_ID}.json",
            "schema": ".claude/dispatch/planner-proposal.schema.json",
            "commit_to": None,
        },
    }


class PlannerProposalDispatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="planner-proposal-")
        self.root = Path(self.temp.name)
        self.artifact = self.root / "proposal.json"
        self.envelope = self.root / "envelope.json"
        self.meta = self.root / "run-meta.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_artifact(self, proposal: dict[str, object]) -> None:
        self.artifact.write_text(json.dumps(proposal), encoding="utf-8")

    def validate_artifact(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "bash",
                str(PROPOSAL_VALIDATOR),
                str(self.artifact),
                TASK_ID,
                BATCH_ID,
                SOURCE_REF,
            ],
            capture_output=True,
            text=True,
        )

    def validate_envelope(self, envelope: dict[str, object]) -> subprocess.CompletedProcess[str]:
        self.envelope.write_text(json.dumps(envelope), encoding="utf-8")
        return subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "envelope", str(self.envelope)],
            capture_output=True,
            text=True,
        )

    def validate_receipt(self, proposal: dict[str, object]) -> subprocess.CompletedProcess[str]:
        self.write_artifact(proposal)
        self.meta.write_text(
            json.dumps(
                {
                    "task_id": TASK_ID,
                    "agent_id": "planner-fixture",
                    "model_family": "fixture",
                    "batch": BATCH_ID,
                    "ref": SOURCE_REF,
                    "role": "planner",
                    "deliverable": planner_envelope()["deliverable"],
                    "artifact": str(self.artifact),
                    "outcome": "RETURNED",
                    "exit_code": 0,
                    "duration_s": 1,
                }
            ),
            encoding="utf-8",
        )
        return subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "receipt", str(self.meta)],
            capture_output=True,
            text=True,
        )

    def test_complete_batch_plan_is_valid_and_receipted(self) -> None:
        self.write_artifact(valid_proposal())
        result = self.validate_artifact()
        self.assertEqual(result.returncode, 0, result.stderr)

        result = self.validate_envelope(planner_envelope())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        result = self.validate_receipt(valid_proposal())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["state"], "COMPLETED")

    def test_input_request_is_valid_but_hands_back_to_coordinator(self) -> None:
        proposal = valid_proposal()
        proposal.update(
            spec=None,
            features=[],
            waiting="input",
            waiting_detail="Choose the retention policy before a complete plan can be proposed.",
        )
        self.write_artifact(proposal)
        result = self.validate_artifact()
        self.assertEqual(result.returncode, 0, result.stderr)

        result = self.validate_receipt(proposal)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["state"], "INPUT_REQUIRED")

    def test_local_cli_planner_preserves_proposal_contract_in_run_meta(self) -> None:
        repo = self.root / "project"
        adapters = self.root / "adapters"
        safe_home = self.root / "safe-home"
        workroot = self.root / "workroot"
        state = repo / ".harness-dispatch"
        repo.mkdir()
        adapters.mkdir()
        safe_home.mkdir()
        subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.email", "fixture@example.invalid"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.name", "fixture"],
            check=True,
        )
        (repo / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "README.md"], check=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
        ref = subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True
        ).strip()

        fake = self.root / "fake-planner.py"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, subprocess\n"
            "ref = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()\n"
            "artifact = os.environ['HARNESS_ARTIFACT']\n"
            "os.makedirs(os.path.dirname(artifact), exist_ok=True)\n"
            "json.dump({\n"
            "  'proposal_version': 'planner-proposal/1',\n"
            "  'task_id': os.environ['HARNESS_TASK_ID'],\n"
            "  'batch_id': os.environ['HARNESS_BATCH'],\n"
            "  'source_ref': ref, 'kind': 'batch_plan',\n"
            "  'created_at': '2026-07-31T00:00:00Z',\n"
            "  'summary': 'A sandboxed planner proposal.', 'questions': [],\n"
            "  'spec': {'title': 'Fixture', 'markdown': '# Fixture'},\n"
            "  'features': [{'id': 'F001', 'title': 'Fixture feature', 'priority': 'high',\n"
            "                'executor': 'generator', 'acceptance': 'A focused test passes.'}],\n"
            "  'decisions': [], 'waiting': None\n"
            "}, open(artifact, 'w'))\n",
            encoding="utf-8",
        )
        fake.chmod(0o755)
        (adapters / "fixture.json").write_text(
            json.dumps(
                {
                    "name": "fixture",
                    "model_family": "fixture",
                    "argv": [str(fake)],
                    "envelope_delivery": "stdin",
                    "_verified": True,
                    "artifact_relpath": "ignored.json",
                }
            ),
            encoding="utf-8",
        )
        registry = repo / ".agents-registry.json"
        registry.write_text(
            json.dumps(
                {
                    "version": "dispatch/1",
                    "agents": [
                        {
                            "id": "fixture-planner",
                            "roles": ["planner"],
                            "transport": "local-cli",
                            "adapter": "fixture",
                            "model_family": "fixture",
                            "constraints": {
                                "l2": False,
                                "write_src": False,
                                "push": False,
                            },
                            "sandbox": {"home_dir": str(safe_home), "env_allow": []},
                            "timeout_s": 60,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        envelope = planner_envelope()
        envelope["repo"] = {"url": str(repo), "ref": ref}
        envelope_path = repo / "envelope.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")

        result = subprocess.run(
            [
                "bash",
                str(HERE / "dispatch-run.sh"),
                "--agent",
                "fixture-planner",
                "--envelope",
                str(envelope_path),
                "--registry",
                str(registry),
                "--adapters",
                str(adapters),
                "--workroot",
                str(workroot),
                "--state",
                str(state),
            ],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        meta = json.loads(result.stdout)
        self.assertEqual(meta["role"], "planner")
        self.assertEqual(meta["deliverable"], envelope["deliverable"])
        self.assertEqual(meta["envelope_path"], str(envelope_path))

        result = subprocess.run(
            ["bash", str(DISPATCH_VALIDATOR), "receipt", str(state / f"run-meta-{TASK_ID}.json")],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt["state"], "COMPLETED")
        self.assertEqual(Path(receipt["envelope_path"]).resolve(), envelope_path.resolve())
        self.assertEqual(receipt["worktree_path"], meta["worktree"])

        request = repo / "planner-request.md"
        request.write_text("Plan the next bounded fixture batch.", encoding="utf-8")
        wrapper_task_id = "planner-wrapper-001"
        result = subprocess.run(
            [
                "bash",
                str(PLANNER_WRAPPER),
                "--agent",
                "fixture-planner",
                "--batch",
                BATCH_ID,
                "--ref",
                ref,
                "--request-file",
                str(request),
                "--task-id",
                wrapper_task_id,
                "--registry",
                str(registry),
                "--adapters",
                str(adapters),
                "--workroot",
                str(workroot),
                "--state",
                str(state),
            ],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        wrapped = json.loads(result.stdout)
        audit = repo / "docs" / "test-reports" / f"planner-proposal-{wrapper_task_id}.json"
        self.assertEqual(wrapped["receipt"]["state"], "COMPLETED")
        self.assertEqual(Path(wrapped["proposal_path"]).resolve(), audit.resolve())
        self.assertTrue(audit.is_file())
        self.assertEqual(json.loads(audit.read_text(encoding="utf-8"))["task_id"], wrapper_task_id)
        self.assertFalse((repo / "progress.json").exists())
        self.assertFalse((repo / "features.json").exists())

    def test_subagent_planner_uses_same_envelope_proposal_and_receipt_chain(self) -> None:
        repo = self.root / "subagent-project"
        state = repo / ".harness-dispatch"
        repo.mkdir()
        subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.email", "fixture@example.invalid"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.name", "fixture"],
            check=True,
        )
        (repo / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "README.md"], check=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
        ref = subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True
        ).strip()
        registry = repo / ".agents-registry.json"
        registry.write_text(
            json.dumps(
                {
                    "version": "dispatch/1",
                    "agents": [
                        {
                            "id": "fixture-subagent-planner",
                            "roles": ["planner"],
                            "transport": "subagent",
                            "agent_type": "planner-proposal",
                            "model_family": "fixture",
                            "constraints": {
                                "l2": False,
                                "write_src": False,
                                "push": False,
                            },
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        request = repo / "planner-request.md"
        request.write_text("Plan the next bounded fixture batch.", encoding="utf-8")
        task_id = "planner-subagent-001"
        canonical_progress = repo / "progress.json"
        canonical_progress.write_text(json.dumps({"status": "planning"}), encoding="utf-8")
        alternate_progress = repo / "alternate-progress.json"
        alternate_progress.write_text(json.dumps({"status": "planning"}), encoding="utf-8")
        prepare_command = [
            "bash",
            str(PLANNER_PREPARE),
            "--agent",
            "fixture-subagent-planner",
            "--batch",
            BATCH_ID,
            "--ref",
            ref,
            "--request-file",
            str(request),
            "--task-id",
            task_id,
            "--registry",
            str(registry),
            "--state",
            str(state),
        ]
        rejected_prepare = subprocess.run(
            [*prepare_command, "--progress", str(alternate_progress)],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(rejected_prepare.returncode, 2, rejected_prepare.stdout + rejected_prepare.stderr)
        self.assertIn("canonical progress", rejected_prepare.stderr)
        self.assertFalse(state.exists())

        result = subprocess.run(prepare_command, cwd=repo, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        prepared = json.loads(result.stdout)
        self.assertEqual(prepared["transport"], "subagent")
        self.assertEqual(prepared["agent_type"], "planner-proposal")

        proposal = valid_proposal()
        proposal["task_id"] = task_id
        proposal["batch_id"] = BATCH_ID
        proposal["source_ref"] = ref
        returned = state / "planner-subagent-return.json"
        returned.write_text(json.dumps(proposal), encoding="utf-8")
        accept_command = [
            "bash",
            str(PLANNER_ACCEPT),
            "--agent",
            "fixture-subagent-planner",
            "--envelope",
            prepared["envelope_path"],
            "--proposal-file",
            str(returned),
            "--registry",
            str(registry),
            "--state",
            str(state),
        ]
        rejected_accept = subprocess.run(
            [*accept_command, "--progress", str(alternate_progress)],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(rejected_accept.returncode, 2, rejected_accept.stdout + rejected_accept.stderr)
        self.assertIn("canonical progress", rejected_accept.stderr)
        self.assertFalse((repo / "docs" / "test-reports" / f"planner-proposal-{task_id}.json").exists())

        result = subprocess.run(accept_command, cwd=repo, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        accepted = json.loads(result.stdout)
        audit = repo / "docs" / "test-reports" / f"planner-proposal-{task_id}.json"
        self.assertEqual(accepted["receipt"]["state"], "COMPLETED")
        self.assertTrue(audit.is_file())
        self.assertEqual(
            json.loads(Path(accepted["run_meta_path"]).read_text(encoding="utf-8"))[
                "envelope_path"
            ],
            prepared["envelope_path"],
        )
        self.assertEqual(json.loads(canonical_progress.read_text(encoding="utf-8")), {"status": "planning"})
        self.assertFalse((repo / "features.json").exists())

    def test_rejects_extra_writeback_fields_and_snapshot_mismatch(self) -> None:
        proposal = valid_proposal()
        proposal["progress_update"] = {"status": "building"}
        self.write_artifact(proposal)
        result = self.validate_artifact()
        self.assertEqual(result.returncode, 2)
        self.assertIn("白名单外字段", result.stderr)

        proposal = valid_proposal()
        proposal["source_ref"] = "b" * 40
        self.write_artifact(proposal)
        result = self.validate_artifact()
        self.assertEqual(result.returncode, 2)
        self.assertIn("dispatch envelope 不匹配", result.stderr)

    def test_planner_envelope_cannot_enable_l2_or_change_artifact_contract(self) -> None:
        invalid = planner_envelope()
        invalid["l2_authorized"] = True
        result = self.validate_envelope(invalid)
        self.assertEqual(result.returncode, 2)
        self.assertIn("l2_authorized", result.stdout)

        invalid = planner_envelope()
        invalid["deliverable"] = copy.deepcopy(invalid["deliverable"])
        invalid["deliverable"]["schema"] = ".claude/autonomous/verdict-artifact.schema.json"
        result = self.validate_envelope(invalid)
        self.assertEqual(result.returncode, 2)
        self.assertIn("planner deliverable.schema", result.stdout)

        invalid = planner_envelope()
        invalid["deliverable"] = copy.deepcopy(invalid["deliverable"])
        invalid["deliverable"]["artifact"] = f"docs/test-reports/{BATCH_ID}-planner-proposal.json"
        result = self.validate_envelope(invalid)
        self.assertEqual(result.returncode, 2)
        self.assertIn("safe-task-id", result.stdout)


if __name__ == "__main__":
    unittest.main()
