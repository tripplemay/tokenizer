#!/usr/bin/env python3
"""Contract tests for the protocol-driven same-session bridge runner."""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
TRANSPORTS = HERE / "transports"
sys.path.insert(0, str(TRANSPORTS))
MODULE_PATH = TRANSPORTS / "session-bridge.py"
SPEC = importlib.util.spec_from_file_location("session_bridge_runner", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load session bridge runner")
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


LAUNCH_NONCE = "0123456789abcdef0123456789abcdef"
LAUNCH_ATTESTATION = "a" * 64
CHILD_RECEIPT_TOKEN = hashlib.sha256(b"future-child-call").hexdigest()
SESSION_RECEIPT_TOKEN = hashlib.sha256(b"future-session").hexdigest()
NONCE_RECEIPT_TOKEN = hashlib.sha256(LAUNCH_NONCE.encode("utf-8")).hexdigest()


class SessionBridgeRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.worktree = Path(self.temp.name) / "worktree"
        self.worktree.mkdir()
        self.worker_state_root = Path(self.temp.name) / "worker-state"
        self.worker_state_root.mkdir()
        self.worker_home = Path(self.temp.name) / "worker-home"
        self.worker_home.mkdir()
        self.worker_tmp = Path(self.temp.name) / "worker-tmp"
        self.worker_tmp.mkdir()
        self.artifact = self.worktree / "docs" / "test-reports" / "bridge-proof.json"
        self.artifact.parent.mkdir(parents=True)
        self.artifact.write_text('{"ok":true}\n', encoding="utf-8")
        self.worker_env = {
            "HOME": str(self.worker_home),
            "TMPDIR": str(self.worker_tmp),
            "PATH": "/provider/staged/bin",
            runner.PROVIDER_LAUNCH_NONCE_ENV: LAUNCH_NONCE,
            runner.PROVIDER_LAUNCH_ATTESTATION_ENV: LAUNCH_ATTESTATION,
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_isolated_interpreter_loads_the_staged_sibling_driver(self) -> None:
        """The VM executes this exact entrypoint using Python isolated mode."""
        result = subprocess.run(
            [sys.executable, "-I", str(MODULE_PATH), "--help"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def protocol(self) -> dict[str, object]:
        return {
            "kind": "acp-native-agent/v1",
            "command": ["future-cli", "acp", "--stdio"],
            "request_delivery": "stdin",
            "response_format": "json",
        }

    def envelope(self, role: str = "planner") -> dict[str, object]:
        return {
            "role": role,
            "deliverable": {"artifact": "docs/test-reports/bridge-proof.json"},
        }

    def proof(self, native_agent_type: str = "plan") -> dict[str, str]:
        return {
            "bridge_kind": "acp-native-agent/v1",
            "session_id_sha256": SESSION_RECEIPT_TOKEN,
            "nonce_sha256": NONCE_RECEIPT_TOKEN,
            "child_call_id_sha256": CHILD_RECEIPT_TOKEN,
            "subagent_type": native_agent_type,
            "terminal_status": "completed",
        }

    def invoke_bridge(
        self,
        *,
        role: str = "planner",
        persona: str = "planner-proposal",
        native_agent_type: str = "plan",
        proof: dict[str, str] | None = None,
        worker_env: dict[str, str] | None = None,
        run_vendor_as_harnessvm: bool = False,
        acp_side_effect: object | None = None,
    ) -> dict[str, object]:
        returned = self.proof(native_agent_type) if proof is None else proof
        with patch.object(
            runner,
            "run_acp_native_agent",
            side_effect=acp_side_effect,
            return_value=None if acp_side_effect is not None else returned,
        ):
            return runner.run_bridge(
                bridge_id="future-acp-bridge",
                strategy="session-bridge-v1",
                protocol=self.protocol(),
                persona=persona,
                native_agent_type=native_agent_type,
                envelope=self.envelope(role),
                worktree=self.worktree,
                timeout_s=60,
                worker_env=self.worker_env if worker_env is None else worker_env,
                worker_state_root=self.worker_state_root,
                run_vendor_as_harnessvm=run_vendor_as_harnessvm,
            )

    def test_manifest_provided_native_types_drive_all_roles_without_tool_branch(self) -> None:
        cases = (
            ("planner", "planner-proposal", "plan"),
            ("generator", "generator-restricted", "coder"),
            ("evaluator", "evaluator", "explore"),
        )
        for role, persona, native_agent_type in cases:
            with self.subTest(role=role):
                calls: list[dict[str, object]] = []

                def fake_acp(**kwargs: object) -> dict[str, str]:
                    calls.append(kwargs)
                    return self.proof(native_agent_type)

                with patch.object(runner, "run_acp_native_agent", side_effect=fake_acp):
                    result = runner.run_bridge(
                        bridge_id="future-acp-bridge",
                        strategy="session-bridge-v1",
                        protocol=self.protocol(),
                        persona=persona,
                        native_agent_type=native_agent_type,
                        envelope=self.envelope(role),
                        worktree=self.worktree,
                        timeout_s=60,
                        worker_env=self.worker_env,
                        worker_state_root=self.worker_state_root,
                    )

                self.assertEqual(calls[0]["command"], ["future-cli", "acp", "--stdio"])
                self.assertEqual(calls[0]["subagent_type"], native_agent_type)
                self.assertIn(
                    f"subagent_type must be {native_agent_type}", str(calls[0]["prompt"])
                )
                self.assertNotIn(runner.PROVIDER_LAUNCH_NONCE_ENV, calls[0]["worker_env"])
                self.assertNotIn(runner.PROVIDER_LAUNCH_ATTESTATION_ENV, calls[0]["worker_env"])
                self.assertTrue(calls[0]["provider_owns_cleanup"])
                self.assertEqual(result["bridge_kind"], "acp-native-agent/v1")
                self.assertEqual(result["subagent_type"], native_agent_type)
                self.assertEqual(result["provider_launch_attestation_sha256"], LAUNCH_ATTESTATION)
                self.assertEqual(result["artifact_sha256"], hashlib.sha256(self.artifact.read_bytes()).hexdigest())
                serialized = json.dumps(result)
                self.assertNotIn("future-session", serialized)
                self.assertNotIn(LAUNCH_NONCE, serialized)

    def test_rejects_missing_or_malformed_provider_launch_context_before_acp_starts(self) -> None:
        cases = (
            ({key: value for key, value in self.worker_env.items() if key != runner.PROVIDER_LAUNCH_NONCE_ENV}, "launch nonce"),
            ({**self.worker_env, runner.PROVIDER_LAUNCH_NONCE_ENV: "not-hex"}, "launch nonce"),
            ({key: value for key, value in self.worker_env.items() if key != runner.PROVIDER_LAUNCH_ATTESTATION_ENV}, "launch attestation"),
            ({**self.worker_env, runner.PROVIDER_LAUNCH_ATTESTATION_ENV: "A" * 64}, "launch attestation"),
        )
        for worker_env, expected in cases:
            with self.subTest(expected=expected):
                with patch.object(runner, "run_acp_native_agent") as acp:
                    with self.assertRaisesRegex(runner.SessionBridgeError, expected):
                        self.invoke_bridge(worker_env=worker_env)
                acp.assert_not_called()

    def test_rejects_worker_environment_keys_outside_the_provider_contract(self) -> None:
        with patch.object(runner, "run_acp_native_agent") as acp:
            with self.assertRaisesRegex(runner.SessionBridgeError, "unsupported key"):
                self.invoke_bridge(worker_env={**self.worker_env, "KIMI_API_KEY": "not-allowed"})
        acp.assert_not_called()

    def test_process_environment_forwards_only_provider_worker_keys(self) -> None:
        with patch.dict(
            runner.os.environ,
            {
                "HOME": "/worker/home",
                "TMPDIR": "/worker/tmp",
                "KIMI_MODEL_NAME": "provider-model",
                runner.PROVIDER_LAUNCH_NONCE_ENV: LAUNCH_NONCE,
                runner.PROVIDER_LAUNCH_ATTESTATION_ENV: LAUNCH_ATTESTATION,
                "KIMI_API_KEY": "host-key-must-not-forward",
                "DATABASE_URL": "host-value-must-not-forward",
            },
            clear=True,
        ):
            observed = runner._provider_worker_environment_from_process()

        self.assertEqual(
            observed,
            {
                "HOME": "/worker/home",
                "TMPDIR": "/worker/tmp",
                "KIMI_MODEL_NAME": "provider-model",
                runner.PROVIDER_LAUNCH_NONCE_ENV: LAUNCH_NONCE,
                runner.PROVIDER_LAUNCH_ATTESTATION_ENV: LAUNCH_ATTESTATION,
            },
        )

    def test_rejects_bridge_proof_that_does_not_match_the_declared_protocol(self) -> None:
        malformed = self.proof()
        malformed["bridge_kind"] = "wrong-kind/v1"
        with self.assertRaisesRegex(runner.SessionBridgeError, "proof shape"):
            self.invoke_bridge(proof=malformed)

    def test_rejects_raw_session_identifier_or_non_hash_receipt_fields(self) -> None:
        cases = (
            ({**self.proof(), "session_id": "future-session"}, "proof shape"),
            ({**self.proof(), "session_id_sha256": "future-session"}, "session_id_sha256"),
            ({**self.proof(), "child_call_id_sha256": "future-child-call"}, "child_call_id_sha256"),
        )
        for proof, expected in cases:
            with self.subTest(expected=expected):
                with self.assertRaisesRegex(runner.SessionBridgeError, expected):
                    self.invoke_bridge(proof=proof)

    def test_rejects_nonce_or_native_type_that_does_not_match_the_provider_context(self) -> None:
        nonce_mismatch = self.proof()
        nonce_mismatch["nonce_sha256"] = hashlib.sha256(b"other").hexdigest()
        with self.assertRaisesRegex(runner.SessionBridgeError, "nonce does not match"):
            self.invoke_bridge(proof=nonce_mismatch)

        type_mismatch = self.proof("coder")
        with self.assertRaisesRegex(runner.SessionBridgeError, "native agent type"):
            self.invoke_bridge(proof=type_mismatch)

    def test_rejects_a_symlinked_commissioned_artifact(self) -> None:
        target = self.worktree / "safe-content.json"
        target.write_text('{"ok":true}\n', encoding="utf-8")
        self.artifact.unlink()
        self.artifact.symlink_to(target)

        with self.assertRaisesRegex(runner.SessionBridgeError, "must not be a symlink"):
            self.invoke_bridge()

    def test_rejects_a_hardlinked_commissioned_artifact(self) -> None:
        target = Path(self.temp.name) / "outside-content.json"
        target.write_text('{"ok":true}\n', encoding="utf-8")
        self.artifact.unlink()
        os.link(target, self.artifact)

        with self.assertRaisesRegex(runner.SessionBridgeError, "multiple links"):
            self.invoke_bridge()

    def test_result_fd_writes_a_bounded_json_record_and_closes_its_capability(self) -> None:
        read_fd, write_fd = os.pipe()
        try:
            runner._write_result_fd(write_fd, {"status": "completed"})
            payload = os.read(read_fd, runner.MAX_RESULT_BYTES + 1)
        finally:
            os.close(read_fd)

        self.assertEqual(json.loads(payload), {"status": "completed"})
        with self.assertRaises(OSError):
            os.fstat(write_fd)

    def test_result_fd_rejects_a_regular_file_capability(self) -> None:
        destination = Path(self.temp.name) / "not-a-pipe.json"
        descriptor = os.open(destination, os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            with self.assertRaisesRegex(runner.SessionBridgeError, "must be a pipe"):
                runner._write_result_fd(descriptor, {"status": "completed"})
        finally:
            os.close(descriptor)

    def test_result_fd_is_secured_before_bridge_launch(self) -> None:
        read_fd, write_fd = os.pipe()
        try:
            flags = fcntl.fcntl(write_fd, fcntl.F_GETFD)
            fcntl.fcntl(write_fd, fcntl.F_SETFD, flags & ~fcntl.FD_CLOEXEC)
            args = SimpleNamespace(
                command="run",
                timeout_s=60,
                result_fd=write_fd,
                result=None,
                protocol_json=json.dumps(self.protocol()),
                persona="planner-proposal",
                envelope=Path(self.temp.name) / "envelope.json",
                bridge_id="future-acp-bridge",
                strategy="session-bridge-v1",
                native_agent_type="plan",
                deliverable_channel="file",
                worktree=self.worktree,
                worker_state_root=self.worker_state_root,
            )

            def fake_run_bridge(**_kwargs: object) -> dict[str, str]:
                self.assertTrue(stat.S_ISFIFO(os.fstat(write_fd).st_mode))
                self.assertTrue(fcntl.fcntl(write_fd, fcntl.F_GETFD) & fcntl.FD_CLOEXEC)
                return {"status": "completed"}

            with (
                patch.object(runner, "parser") as parser,
                patch.object(runner, "_require_root_result_supervisor") as require_root,
                patch.object(runner, "_load_protocol", return_value=self.protocol()),
                patch.object(runner, "_read_envelope", return_value=self.envelope()),
                patch.object(runner, "_provider_worker_environment_from_process", return_value=self.worker_env),
                patch.object(runner, "run_bridge", side_effect=fake_run_bridge),
            ):
                parser.return_value.parse_args.return_value = args
                self.assertEqual(runner.main(), 0)
                require_root.assert_called_once_with()

            self.assertEqual(json.loads(os.read(read_fd, runner.MAX_RESULT_BYTES + 1)), {"status": "completed"})
        finally:
            try:
                os.close(write_fd)
            except OSError:
                pass
            os.close(read_fd)

    def test_regular_result_fd_is_rejected_before_bridge_launch(self) -> None:
        destination = Path(self.temp.name) / "not-a-pipe-before-launch.json"
        descriptor = os.open(destination, os.O_CREAT | os.O_WRONLY, 0o600)
        args = SimpleNamespace(
            command="run",
            timeout_s=60,
            result_fd=descriptor,
            result=None,
            protocol_json=json.dumps(self.protocol()),
            persona="planner-proposal",
            envelope=Path(self.temp.name) / "envelope.json",
            bridge_id="future-acp-bridge",
            strategy="session-bridge-v1",
            native_agent_type="plan",
            deliverable_channel="file",
            worktree=self.worktree,
            worker_state_root=self.worker_state_root,
        )
        try:
            with (
                contextlib.redirect_stderr(io.StringIO()),
                patch.object(runner, "parser") as parser,
                patch.object(runner, "_require_root_result_supervisor"),
                patch.object(runner, "run_bridge") as run_bridge,
            ):
                parser.return_value.parse_args.return_value = args
                self.assertEqual(runner.main(), 2)
                run_bridge.assert_not_called()
        finally:
            os.close(descriptor)

    def test_strict_provider_route_marks_the_vendor_for_harnessvm_execution(self) -> None:
        calls: list[dict[str, object]] = []

        def fake_acp(**kwargs: object) -> dict[str, str]:
            calls.append(kwargs)
            return self.proof()

        self.invoke_bridge(
            run_vendor_as_harnessvm=True,
            acp_side_effect=fake_acp,
        )

        self.assertTrue(calls[0]["run_as_harnessvm"])

    def test_result_pipe_mode_requires_a_root_supervisor(self) -> None:
        with patch.object(runner.os, "geteuid", return_value=501):
            with self.assertRaisesRegex(runner.SessionBridgeError, "root supervisor"):
                runner._require_root_result_supervisor()


if __name__ == "__main__":
    unittest.main()
