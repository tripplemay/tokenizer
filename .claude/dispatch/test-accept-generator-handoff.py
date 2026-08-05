#!/usr/bin/env python3
"""Regression fixtures for Coordinator acceptance of a Generator sandbox diff."""

from __future__ import annotations

import base64
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
ACCEPT = HERE / "accept-generator-handoff.sh"
TOOL_CATALOG = HERE / "tool-catalog.py"
BATCH = "BL-ACCEPT-FIXTURE"
FEATURE = "F001"
TASK = "accept-fixture-001"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def provider_attestation_digest(value: dict[str, object]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(
        b"harness/external-bridge-provider-attestation/1\0" + encoded
    ).hexdigest()


class AcceptGeneratorHandoffTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="accept-generator-handoff-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "main"
        self.repo.mkdir()
        self.git(self.repo, "init", "-q")
        self.git(self.repo, "config", "user.email", "fixture@example.invalid")
        self.git(self.repo, "config", "user.name", "fixture")
        (self.repo / "src").mkdir()
        (self.repo / "src" / "base.txt").write_text("base\n", encoding="utf-8")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-qm", "base")
        self.ref = self.output(self.repo, "rev-parse", "HEAD")

        self.sandbox = self.root / "sandbox"
        self.git(self.root, "clone", "-q", str(self.repo), str(self.sandbox))
        self.git(self.sandbox, "config", "user.email", "fixture@example.invalid")
        self.git(self.sandbox, "config", "user.name", "fixture")
        (self.sandbox / "src" / "generated.txt").write_text("generated\n", encoding="utf-8")

        self.envelope = self.root / "envelope.json"
        self.handoff = self.sandbox / "docs" / "test-reports" / f"generator-handoff-{TASK}.json"
        write_json(
            self.envelope,
            {
                "task_id": TASK,
                "contract_version": "harness/1.1",
                "batch": BATCH,
                "role": "generator",
                "repo": {"url": ".", "ref": self.ref},
                "spec": None,
                "features": [FEATURE],
                "l2_authorized": False,
                "contract": "Implement only the commissioned feature and return a structured handoff artifact.",
                "deliverable": {
                    "artifact": f"docs/test-reports/generator-handoff-{TASK}.json",
                    "schema": ".claude/dispatch/generator-handoff.schema.json",
                    "commit_to": None,
                },
            },
        )
        write_json(
            self.handoff,
            {
                "batch_id": BATCH,
                "created_at": "2026-07-31T00:00:00Z",
                "features": [{"feature_id": FEATURE, "files_touched": ["src/generated.txt"], "commits": []}],
                "l1_ran": {"lint": "fixture", "typecheck": "fixture", "test": "fixture"},
                "waiting": None,
            },
        )
        self.meta = self.root / "run-meta.json"
        write_json(
            self.meta,
            {
                "task_id": TASK,
                "agent_id": "fixture-generator",
                "model_family": "fixture",
                "batch": BATCH,
                "ref": self.ref,
                "role": "generator",
                "deliverable": json.loads(self.envelope.read_text())["deliverable"],
                "artifact": str(self.handoff.resolve()),
                "envelope_path": str(self.envelope.resolve()),
                "worktree": str(self.sandbox.resolve()),
                "outcome": "RETURNED",
                "exit_code": 0,
                "duration_s": 1,
                "transport": "local-cli",
            },
        )
        self.l1 = self.root / "l1.json"
        write_json(
            self.l1,
            {
                "version": "harness-l1/1",
                "commands": [
                    {"name": "lint", "argv": [sys.executable, "-c", "pass"]},
                    {"name": "typecheck", "argv": [sys.executable, "-c", "pass"]},
                    {"name": "test", "argv": [sys.executable, "-c", "pass"]},
                ],
            },
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, cwd: Path, *args: str) -> None:
        subprocess.run(["git", "-C", str(cwd), *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def output(self, cwd: Path, *args: str) -> str:
        return subprocess.check_output(["git", "-C", str(cwd), *args], text=True).strip()

    def resolve_catalog(
        self, registry: Path, adapters: Path, bindings: dict[str, object]
    ) -> dict[str, object]:
        """Build an active checkpoint from the same catalog used at runtime."""
        bindings_path = self.root / "catalog-bindings.json"
        write_json(bindings_path, bindings)
        result = subprocess.run(
            [
                sys.executable,
                str(TOOL_CATALOG),
                "resolve",
                "--registry",
                str(registry),
                "--adapters",
                str(adapters),
                "--bindings",
                str(bindings_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertIsInstance(value, dict)
        return value

    def enable_active_v2_generator_checkpoint(self) -> tuple[Path, Path, Path]:
        """Create the smallest real signed v2 checkpoint for direct-accept tests."""
        openssl = os.environ.get("HARNESS_OPENSSL", "/opt/homebrew/bin/openssl")
        probe = subprocess.run(
            [openssl, "list", "-public-key-algorithms"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self.assertEqual(probe.returncode, 0)
        self.assertIn("ED25519", probe.stdout.upper())
        self.git(self.repo, "remote", "add", "origin", "git@github.com:acme/accept-fixture.git")

        private_key = self.root / "console.key"
        public_key = self.root / "console.pub"
        subprocess.run(
            [openssl, "genpkey", "-algorithm", "Ed25519", "-out", str(private_key)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            [openssl, "pkey", "-in", str(private_key), "-pubout", "-out", str(public_key)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        adapters = self.root / "adapters"
        adapters.mkdir()
        write_json(
            adapters / "fixture.json",
            {
                "name": "fixture",
                "model_family": "generator",
                "argv": ["true"],
                "envelope_delivery": "stdin",
                "_verified": True,
            },
        )
        write_json(
            adapters / "planner.json",
            {
                "name": "planner",
                "model_family": "planner",
                "argv": ["true"],
                "envelope_delivery": "stdin",
                "_verified": True,
            },
        )
        write_json(
            adapters / "evaluator.json",
            {
                "name": "evaluator",
                "model_family": "evaluator",
                "argv": ["true"],
                "envelope_delivery": "stdin",
                "_verified": True,
            },
        )
        registry = self.repo / ".agents-registry.json"
        write_json(
            registry,
            {
                "version": "dispatch/1",
                "agents": [
                    {
                        "id": "fixture-planner",
                        "roles": ["planner"],
                        "transport": "local-cli",
                        "adapter": "planner",
                        "model_family": "planner",
                        "sandbox": {"home_dir": str(self.root / "planner-home")},
                        "constraints": {"l2": False, "write_src": False, "push": False},
                    },
                    {
                        "id": "fixture-generator",
                        "roles": ["generator"],
                        "transport": "local-cli",
                        "adapter": "fixture",
                        "model_family": "generator",
                        "sandbox": {"home_dir": str(self.root / "safe-home")},
                        "constraints": {"l2": False, "write_src": True, "push": False},
                    },
                    {
                        "id": "fixture-evaluator",
                        "roles": ["evaluator"],
                        "transport": "local-cli",
                        "adapter": "evaluator",
                        "model_family": "evaluator",
                        "sandbox": {"home_dir": str(self.root / "evaluator-home")},
                        "constraints": {"l2": False, "write_src": False, "push": False},
                    },
                ],
            },
        )
        now = datetime.datetime.now(datetime.timezone.utc)
        iso = lambda value: value.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        intent = {
            "intent_id": "intent-accept-fixture-001",
            "repo_key": "github.com/acme/accept-fixture",
            "expected_head_sha": self.ref,
            "desired": {
                "execution": {
                    "profile": "heterogeneous",
                    "role_bindings": {
                        "planner": {"tool": "planner", "invocation": "local-cli"},
                        "generator": {"tool": "fixture", "invocation": "local-cli"},
                        "evaluator": {"tool": "evaluator", "invocation": "local-cli"},
                    },
                },
                "autonomy": {"enabled": False},
            },
            "issued_by": "fixture@example.invalid",
            "issued_at": iso(now - datetime.timedelta(minutes=1)),
            "intent_expires_at": iso(now + datetime.timedelta(days=1)),
        }
        payload = json.dumps(intent, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        payload_path = self.root / "intent-payload.json"
        signature_path = self.root / "intent-signature.bin"
        payload_path.write_bytes(payload)
        subprocess.run(
            [openssl, "pkeyutl", "-sign", "-inkey", str(private_key), "-rawin", "-in", str(payload_path), "-out", str(signature_path)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        intent["sig"] = base64.b64encode(signature_path.read_bytes()).decode("ascii")
        resolution = self.resolve_catalog(
            registry,
            adapters,
            {
                "planner": {"tool": "planner", "invocation": "local-cli"},
                "generator": {"tool": "fixture", "invocation": "local-cli"},
                "evaluator": {"tool": "evaluator", "invocation": "local-cli"},
            },
        )
        write_json(
            self.repo / "progress.json",
            {
                "status": "building",
                "current_sprint": BATCH,
                "role_assignments": {role: record["agent_id"] for role, record in resolution.items()},
                "mode_intent": {
                    "intent_id": intent["intent_id"],
                    "applied_batch": BATCH,
                    "applied_at": iso(now),
                    "signed_intent": intent,
                    "resolution": resolution,
                },
            },
        )
        return registry, adapters, public_key

    def invoke(
        self,
        *extra: str,
        env: dict[str, str] | None = None,
        accept: Path = ACCEPT,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "bash", str(accept),
                "--handoff", str(self.handoff),
                "--envelope", str(self.envelope),
                "--run-meta", str(self.meta),
                "--l1-commands", str(self.l1),
                *extra,
            ],
            cwd=self.repo,
            text=True,
            capture_output=True,
            env={**os.environ, **(env or {})},
        )

    def external_accept_dispatch_fixture(self) -> Path:
        """Run the real accept entrypoint against a fixed external target.

        Production target resolution is intentionally tied to the installed
        app-owned provider, which tests must not replace. This isolated copy
        retains the accept script and return-route validator verbatim while
        standing in for the already re-verified active role/target boundary.
        """
        dispatch = self.root / "external-accept-dispatch"
        dispatch.mkdir()
        for name in (
            "accept-generator-handoff.sh",
            "dispatch_common.py",
            "validate-dispatch.sh",
            "validate-generator-handoff.sh",
            "validate-external-bridge-receipt.py",
            "validate-active-return-route.py",
        ):
            shutil.copy2(HERE / name, dispatch / name)
        (dispatch / "resolve-active-mode-role.sh").write_text(
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' '{\"agent_id\":\"fixture-generator\",\"tool\":\"fixture\",\"invocation\":\"subagent\",\"model_family\":\"generator\",\"priority\":1,\"execution_provenance_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}'\n",
            encoding="utf-8",
        )
        (dispatch / "resolve-active-mode-role.sh").chmod(0o755)
        (dispatch / "tool-catalog.py").write_text(
            "import json\n"
            "print(json.dumps({\n"
            "  'target_id': 'fixture-generator', 'invocation': 'subagent',\n"
            "  'bridge_id': 'fixture-acp', 'bridge_strategy': 'session-bridge-v1',\n"
            "  'bridge_protocol': {'kind': 'acp-native-agent/v1'},\n"
            "  'session_scope': 'same-session'\n"
            "}))\n",
            encoding="utf-8",
        )
        return dispatch

    def configure_provider_subagent_result(self) -> None:
        """Create the exact provider-owned staging layout returned by vm-v1."""
        state = self.root / "provider-state"
        staging = state / "vm-v1-runs" / f"{TASK}-{'a' * 24}" / "copyout"
        staging.parent.mkdir(parents=True)
        self.git(self.root, "clone", "-q", str(self.repo), str(staging))
        (staging / "src" / "generated.txt").write_text("generated\n", encoding="utf-8")
        self.handoff = staging / "docs" / "test-reports" / f"generator-handoff-{TASK}.json"
        write_json(
            self.handoff,
            {
                "batch_id": BATCH,
                "created_at": "2026-07-31T00:00:00Z",
                "features": [{"feature_id": FEATURE, "files_touched": ["src/generated.txt"], "commits": []}],
                "l1_ran": {"lint": "fixture", "typecheck": "fixture", "test": "fixture"},
                "waiting": None,
            },
        )
        attestation: dict[str, object] = {
            "version": "harness/external-bridge-provider-attestation/1",
            "provider_id": "harness-vm-v1",
            "provider_kind": "vm-v1",
            "contract_sha256": "b" * 64,
            "phase": "launch",
            "nonce_sha256": "c" * 64,
            "issued_at": "2026-08-01T00:00:00Z",
            "expires_at": "2026-08-01T00:05:00Z",
            "image_sha256": "d" * 64,
            "runner_sha256": "e" * 64,
            "cli_bundle_sha256": "f" * 64,
            "broker_policy_sha256": "0" * 64,
            "target_provenance_sha256": "1" * 64,
        }
        bridge = {
            "bridge_id": "fixture-acp",
            "bridge_strategy": "session-bridge-v1",
            "bridge_kind": "acp-native-agent/v1",
            "session_scope": "same-session",
            "session_id_sha256": "2" * 64,
            "nonce_sha256": attestation["nonce_sha256"],
            "child_call_id_sha256": "3" * 64,
            "subagent_type": "coder",
            "terminal_status": "completed",
            "provider_launch_attestation_sha256": provider_attestation_digest(attestation),
            "artifact_sha256": hashlib.sha256(self.handoff.read_bytes()).hexdigest(),
            "provider_launch_attestation": attestation,
        }
        self.meta = state / f"run-meta-{TASK}.json"
        write_json(
            self.meta,
            {
                "task_id": TASK,
                "agent_id": "fixture-generator",
                "model_family": "fixture",
                "batch": BATCH,
                "ref": self.ref,
                "role": "generator",
                "deliverable": json.loads(self.envelope.read_text())["deliverable"],
                "artifact": str(self.handoff.resolve()),
                "envelope_path": str(self.envelope.resolve()),
                "worktree": str(staging.resolve()),
                "outcome": "RETURNED",
                "exit_code": 0,
                "duration_s": 1,
                "transport": "subagent",
                "bridge": bridge,
                "source_changes": ["src/generated.txt"],
            },
        )

    def test_dry_run_validates_exact_diff_without_touching_main(self) -> None:
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        outcome = json.loads(result.stdout)
        self.assertEqual(outcome["state"], "READY_TO_APPLY")
        self.assertEqual(outcome["files_touched"], ["src/generated.txt"])
        self.assertFalse((self.repo / "src" / "generated.txt").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_provider_subagent_handoff_requires_a_signed_active_route(self) -> None:
        self.configure_provider_subagent_result()
        result = self.invoke()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("re-verified active mode role", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_apply_commits_the_validated_feature_and_immutable_handoff(self) -> None:
        result = self.invoke("--apply")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        outcome = json.loads(result.stdout)
        self.assertEqual(outcome["state"], "APPLIED")
        self.assertTrue((self.repo / "src" / "generated.txt").is_file())
        audit = self.repo / "docs" / "test-reports" / f"generator-handoff-{TASK}.json"
        self.assertTrue(audit.is_file())
        self.assertEqual(audit.read_text(encoding="utf-8"), self.handoff.read_text(encoding="utf-8"))
        self.assertEqual(outcome["handoff_artifact"], audit.relative_to(self.repo).as_posix())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")
        committed_paths = self.output(self.repo, "show", "--format=", "--name-only", "HEAD").splitlines()
        self.assertEqual(set(committed_paths), {"src/generated.txt", audit.relative_to(self.repo).as_posix()})
        self.assertEqual(
            self.output(self.repo, "log", "-1", "--pretty=%s"),
            f"feat({BATCH}-{FEATURE}): accept external generator handoff",
        )

    def test_rejects_undeclared_sandbox_diff_before_apply(self) -> None:
        (self.sandbox / "src" / "extra.txt").write_text("extra\n", encoding="utf-8")
        result = self.invoke("--apply")
        self.assertEqual(result.returncode, 2)
        self.assertIn("must exactly match", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_rejects_dirty_main_checkout_before_apply(self) -> None:
        (self.repo / "src" / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        result = self.invoke("--apply")
        self.assertEqual(result.returncode, 2)
        self.assertIn("must be clean", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())

    def test_rejects_an_unsafe_artifact_path_before_using_run_metadata(self) -> None:
        envelope = json.loads(self.envelope.read_text())
        envelope["deliverable"]["artifact"] = "../outside.json"
        self.envelope.write_text(json.dumps(envelope), encoding="utf-8")
        result = self.invoke()
        self.assertEqual(result.returncode, 2)
        self.assertIn("安全仓内相对路径", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())

    def test_rejects_declared_control_plane_path_before_l1_or_apply(self) -> None:
        handoff = json.loads(self.handoff.read_text(encoding="utf-8"))
        handoff["features"][0]["files_touched"] = ["harness.json"]
        self.handoff.write_text(json.dumps(handoff), encoding="utf-8")
        result = self.invoke("--apply")
        self.assertEqual(result.returncode, 2)
        self.assertIn("control file", result.stderr)
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_rejects_actual_control_plane_diff_even_when_not_declared(self) -> None:
        (self.sandbox / "harness.json").write_text('{"attacker":true}\n', encoding="utf-8")
        result = self.invoke("--apply")
        self.assertEqual(result.returncode, 2)
        self.assertIn("sandbox diff contains forbidden", result.stderr)
        self.assertFalse((self.repo / "harness.json").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_active_checkpoint_rejects_wrong_run_meta_agent_before_return_validation(self) -> None:
        registry, adapters, public_key = self.enable_active_v2_generator_checkpoint()
        self.git(self.repo, "add", "progress.json", ".agents-registry.json")
        self.git(self.repo, "commit", "-qm", "active checkpoint")
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        meta["agent_id"] = "forged-generator"
        self.meta.write_text(json.dumps(meta), encoding="utf-8")
        result = self.invoke(
            "--progress", str(self.repo / "progress.json"),
            "--registry", str(registry),
            "--adapters", str(adapters),
            "--pub", str(public_key),
            env={"HARNESS_OPENSSL": os.environ.get("HARNESS_OPENSSL", "/opt/homebrew/bin/openssl")},
        )
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("re-verified active", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_active_local_route_rejects_a_forged_subagent_return(self) -> None:
        registry, adapters, public_key = self.enable_active_v2_generator_checkpoint()
        self.git(self.repo, "add", "progress.json", ".agents-registry.json")
        self.git(self.repo, "commit", "-qm", "active checkpoint")
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        meta["transport"] = "subagent"
        self.meta.write_text(json.dumps(meta), encoding="utf-8")
        result = self.invoke(
            "--progress", str(self.repo / "progress.json"),
            "--registry", str(registry),
            "--adapters", str(adapters),
            "--pub", str(public_key),
            env={"HARNESS_OPENSSL": os.environ.get("HARNESS_OPENSSL", "/opt/homebrew/bin/openssl")},
        )
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("transport does not match", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_active_external_route_rejects_a_forged_local_cli_return(self) -> None:
        registry, adapters, public_key = self.enable_active_v2_generator_checkpoint()
        self.git(self.repo, "add", "progress.json", ".agents-registry.json")
        self.git(self.repo, "commit", "-qm", "active checkpoint")
        dispatch = self.external_accept_dispatch_fixture()
        result = self.invoke(
            "--progress", str(self.repo / "progress.json"),
            "--registry", str(registry),
            "--adapters", str(adapters),
            "--pub", str(public_key),
            env={"HARNESS_OPENSSL": os.environ.get("HARNESS_OPENSSL", "/opt/homebrew/bin/openssl")},
            accept=dispatch / "accept-generator-handoff.sh",
        )
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("transport does not match", result.stderr)
        self.assertFalse((self.repo / "src" / "generated.txt").exists())
        self.assertEqual(self.output(self.repo, "status", "--porcelain"), "")

    def test_active_acceptance_rejects_outside_or_symlinked_registry_before_return_work(self) -> None:
        (self.repo / "progress.json").write_text("{}", encoding="utf-8")
        registry = self.repo / ".agents-registry.json"
        registry.write_text("{}", encoding="utf-8")
        outside = self.root / "outside-registry.json"
        outside.write_text("{}", encoding="utf-8")

        result = self.invoke("--registry", str(outside))
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("registry", result.stderr.lower())
        self.assertFalse((self.repo / "src" / "generated.txt").exists())

        registry.unlink()
        registry.symlink_to(outside)
        result = self.invoke()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("registry", result.stderr.lower())
        self.assertFalse((self.repo / "src" / "generated.txt").exists())

    def test_l1_runs_without_coordinator_secret_or_runtime_control_env(self) -> None:
        l1 = json.loads(self.l1.read_text(encoding="utf-8"))
        l1["commands"][0]["argv"] = [
            sys.executable,
            "-c",
            "import os, sys; forbidden=('HARNESS_SECRET_SENTINEL','GIT_CONFIG_COUNT','NODE_OPTIONS'); sys.exit(any(key in os.environ for key in forbidden))",
        ]
        self.l1.write_text(json.dumps(l1), encoding="utf-8")
        result = self.invoke(
            env={
                "HARNESS_SECRET_SENTINEL": "must-not-reach-l1",
                "GIT_CONFIG_COUNT": "9",
                "NODE_OPTIONS": "--require attacker",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["state"], "READY_TO_APPLY")


if __name__ == "__main__":
    unittest.main(verbosity=2)
