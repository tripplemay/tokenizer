#!/usr/bin/env python3
"""Focused trust-boundary tests for the root VM bridge supervisor."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
WORKER_PATH = HERE / "transports" / "vm-bridge-worker.py"
SPEC = importlib.util.spec_from_file_location("vm_bridge_worker", WORKER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load vm bridge worker module")
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


NONCE = "0123456789abcdef0123456789abcdef"
ATTESTATION = "a" * 64


def private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)


class ExitedProcess:
    pid = 4242

    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.wait_calls = 0

    def poll(self) -> int:
        return 0

    def wait(self, timeout: float | None = None) -> int:
        del timeout
        self.wait_calls += 1
        self.events.append("wait")
        return 0


class VmBridgeWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="vm-bridge-worker-")
        self.root = Path(self.temp.name) / "job"
        self.source = self.root / "source"
        self.state = self.root / "state"
        self.receipt_dir = self.root / "receipt"
        for path in (self.root, self.source, self.state, self.receipt_dir):
            private_directory(path)
        self.target = self.root / ".harness-target.json"
        self.envelope = self.root / ".harness-envelope.json"
        self.target.write_text("{}\n", encoding="utf-8")
        self.envelope.write_text(
            json.dumps(
                {
                    "role": "planner",
                    "deliverable": {"artifact": "docs/test-reports/proposal.json"},
                }
            ),
            encoding="utf-8",
        )
        os.chmod(self.target, 0o600)
        os.chmod(self.envelope, 0o600)
        self.artifact = self.source / "docs" / "test-reports" / "proposal.json"
        private_directory(self.source / "docs")
        private_directory(self.artifact.parent)
        self.artifact.write_text('{"proposal":"ok"}\n', encoding="utf-8")
        os.chmod(self.artifact, 0o600)
        self.identity = worker.WorkerIdentity(os.getuid(), os.getgid())

    def tearDown(self) -> None:
        self.temp.cleanup()

    def args(self, *, receipt: Path | None = None) -> SimpleNamespace:
        return SimpleNamespace(
            target=self.target,
            envelope=self.envelope,
            worktree=self.source,
            worker_state_root=self.state,
            receipt=receipt or self.receipt_dir / "bridge-result.json",
            timeout_s=60,
        )

    def root_identity_patch(self) -> Any:
        return patch.multiple(
            worker,
            ROOT_UID=os.getuid(),
            ROOT_GID=os.getgid(),
        )

    def test_guest_layout_requires_the_root_only_receipt_path(self) -> None:
        with self.root_identity_patch():
            layout = worker._guest_layout(self.args(), self.identity)
            self.assertEqual(layout.receipt, self.receipt_dir / "bridge-result.json")
            with self.assertRaisesRegex(worker.WorkerError, "receipt path"):
                worker._guest_layout(
                    self.args(receipt=self.state / "bridge-result.json"), self.identity
                )

            os.chmod(self.receipt_dir, 0o777)
            with self.assertRaisesRegex(worker.WorkerError, "receipt directory"):
                worker._guest_layout(self.args(), self.identity)

    def test_copyout_reads_the_root_receipt_argument_not_worker_state(self) -> None:
        receipt = self.receipt_dir / "bridge-result.json"
        receipt.write_text('{"bridge":"root-owned"}\n', encoding="utf-8")
        os.chmod(receipt, 0o600)
        output = io.BytesIO()
        args = SimpleNamespace(
            worktree=self.source,
            receipt=receipt,
            artifact="docs/test-reports/proposal.json",
        )
        with self.root_identity_patch(), patch.object(worker, "_require_root"), patch.object(
            worker, "_worker_identity", return_value=self.identity
        ), patch.object(worker.sys, "stdout", SimpleNamespace(buffer=output)):
            self.assertEqual(worker.copyout(args), 0)

        output.seek(0)
        with tarfile.open(fileobj=output, mode="r:gz") as archive:
            member = archive.extractfile("receipt/bridge-result.json")
            assert member is not None
            self.assertEqual(member.read(), b'{"bridge":"root-owned"}\n')

    def test_reap_signals_a_verified_group_after_its_parent_has_exited(self) -> None:
        events: list[str] = []
        process = ExitedProcess(events)
        calls: list[tuple[int, int]] = []

        def killpg(group: int, signal: int) -> None:
            calls.append((group, signal))
            if signal == 0:
                raise ProcessLookupError

        with patch.object(worker.os, "killpg", side_effect=killpg):
            worker.reap_group(process, process.pid)

        self.assertEqual(process.poll(), 0)
        self.assertEqual(calls[0], (process.pid, worker.signal.SIGTERM))
        self.assertIn("wait", events)

    def test_root_supervisor_reaps_before_consuming_the_pipe_and_writes_receipt(self) -> None:
        artifact_sha256 = hashlib.sha256(b'{"proposal":"ok"}\n').hexdigest()
        target = {
            "bridge_id": "kimi-acp-native-agent",
            "bridge_strategy": "session-bridge-v1",
            "bridge_protocol": {
                "kind": "acp-native-agent/v1",
                "command": ["kimi", "acp"],
                "request_delivery": "stdin",
                "response_format": "json",
            },
            "native_agent_type": "coder",
            "deliverable_channel": "file",
            "agent_type": "planner-proposal",
        }
        result = {
            "bridge_id": target["bridge_id"],
            "bridge_strategy": target["bridge_strategy"],
            "bridge_kind": "acp-native-agent/v1",
            "session_scope": "same-session",
            "session_id_sha256": "b" * 64,
            "nonce_sha256": hashlib.sha256(NONCE.encode("ascii")).hexdigest(),
            "child_call_id_sha256": "c" * 64,
            "subagent_type": target["native_agent_type"],
            "terminal_status": "completed",
            "provider_launch_attestation_sha256": ATTESTATION,
            "artifact_sha256": artifact_sha256,
        }
        events: list[str] = []
        process = ExitedProcess(events)
        launched: dict[str, Any] = {}

        def popen(command: list[str], **kwargs: Any) -> ExitedProcess:
            launched["command"] = command
            launched["kwargs"] = kwargs
            descriptor = int(command[command.index("--result-fd") + 1])
            os.write(descriptor, worker._result_json(result))
            return process

        original_read = worker._read_result_pipe

        def read_pipe(descriptor: int) -> dict[str, Any]:
            events.append("read")
            return original_read(descriptor)

        environment = {
            "HARNESS_PROVIDER_LAUNCH_NONCE": NONCE,
            "HARNESS_PROVIDER_LAUNCH_ATTESTATION_SHA256": ATTESTATION,
            "HARNESS_PROVIDER_BROKER_BASE_URL": "http://192.168.5.2:12345",
            "HARNESS_PROVIDER_BROKER_LEASE": "lease-" + "x" * 32,
            "PATH": "/usr/bin:/bin",
        }
        with self.root_identity_patch(), patch.dict(worker.os.environ, environment, clear=True), patch.object(
            worker, "_worker_identity", return_value=self.identity
        ), patch.object(worker, "target_from", return_value=target), patch.object(
            worker.subprocess, "Popen", side_effect=popen
        ), patch.object(worker, "_owned_process_group", return_value=process.pid), patch.object(
            worker, "reap_group", side_effect=lambda _process, _group: events.append("reap")
        ), patch.object(worker, "_read_result_pipe", side_effect=read_pipe):
            self.assertEqual(worker.run(self.args()), 0)

        self.assertEqual(events, ["wait", "reap", "read"])
        self.assertIn("--result-fd", launched["command"])
        self.assertNotIn("--result", launched["command"])
        self.assertEqual(launched["kwargs"]["pass_fds"], (launched["kwargs"]["pass_fds"][0],))
        self.assertTrue(launched["kwargs"]["start_new_session"])
        self.assertTrue(launched["kwargs"]["close_fds"])
        self.assertNotIn("user", launched["kwargs"])
        receipt = json.loads((self.receipt_dir / "bridge-result.json").read_text(encoding="utf-8"))
        self.assertEqual(receipt, result)

    def test_commissioned_artifact_digest_streams_with_no_follow_open(self) -> None:
        expected = hashlib.sha256(b'{"proposal":"ok"}\n').hexdigest()
        original_open = os.open
        with patch.object(Path, "read_bytes", side_effect=AssertionError("pathname read")), patch.object(
            worker.os, "open", wraps=original_open
        ) as opened:
            self.assertEqual(
                worker._commissioned_artifact_sha256(self.artifact, self.identity), expected
            )

        self.assertEqual(opened.call_count, 1)
        flags = opened.call_args.args[1]
        self.assertNotEqual(flags & os.O_NOFOLLOW, 0)

    def test_commissioned_artifact_digest_rejects_an_oversized_file_before_opening(self) -> None:
        os.truncate(self.artifact, worker.MAX_COPYOUT_BYTES + 1)
        with patch.object(worker.os, "open", side_effect=AssertionError("must not open")) as opened:
            with self.assertRaisesRegex(worker.WorkerError, "exceeds the copy-out size limit"):
                worker._commissioned_artifact_sha256(self.artifact, self.identity)
        opened.assert_not_called()

    def test_commissioned_artifact_digest_rejects_inode_replacement_before_reading(self) -> None:
        replacement = self.source / "replacement.json"
        replacement.write_text('{"proposal":"replaced"}\n', encoding="utf-8")
        os.chmod(replacement, 0o600)
        original_open = os.open

        def replace_then_open(path: str | bytes | os.PathLike[str], flags: int) -> int:
            os.replace(replacement, self.artifact)
            return original_open(path, flags)

        with patch.object(worker.os, "open", side_effect=replace_then_open):
            with self.assertRaisesRegex(worker.WorkerError, "changed before digest"):
                worker._commissioned_artifact_sha256(self.artifact, self.identity)

    def test_result_pipe_rejects_duplicate_json_keys(self) -> None:
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, b'{"bridge_id":"one","bridge_id":"two"}\n')
            os.close(write_fd)
            write_fd = -1
            with self.assertRaisesRegex(worker.WorkerError, "duplicate keys"):
                worker._read_result_pipe(read_fd)
        finally:
            if write_fd >= 0:
                os.close(write_fd)
            os.close(read_fd)


if __name__ == "__main__":
    unittest.main()
