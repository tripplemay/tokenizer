#!/usr/bin/env python3
"""Independent evaluator probe for the FIX2 terminal-message deliverable channel.

Written from scratch by the round-3 fresh-context Evaluator; it does not import
or reuse the Generator's test modules.  It drives the production
``session-bridge.py`` / ``session_bridge_kimi.py`` / ``vm-bridge-provider.py``
sources in place (no product code is modified) with a scripted ACP peer, and
asserts the D8/D9 semantics the spec now requires:

  * terminal-message materializes the *root* relayed text at the artifact path,
    0600, exclusive-create, never through a symlink;
  * the resulting receipt binds ``artifact_sha256`` to the materialized bytes
    and still leaks no model text;
  * empty / oversized deliverables and a pre-existing artifact fail closed;
  * ``file`` channel behaviour is unchanged (driver writes nothing itself);
  * D9: the commissioned artifact path may overwrite its baseline copy and the
    overwrite is counted in ``source_changes``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
DISPATCH = REPO / ".claude" / "dispatch"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# session-bridge.py imports its Kimi driver as a sibling module, exactly as the
# production worker does (it runs with the transports dir on sys.path).
sys.path.insert(0, str(DISPATCH / "transports"))
KIMI = _load("session_bridge_kimi", DISPATCH / "transports" / "session_bridge_kimi.py")
BRIDGE = _load("probe_session_bridge", DISPATCH / "transports" / "session-bridge.py")
PROVIDER = _load("probe_vm_bridge_provider", DISPATCH / "transports" / "vm-bridge-provider.py")

NONCE = "0123456789abcdef0123456789abcdef"
SESSION = "session-probe-0001"
CALL = "call-probe-0001"


class _Stdin(io.StringIO):
    def close(self) -> None:  # keep the transcript readable after the driver closes it
        self.closed_by_driver = True


class ScriptedPeer:
    """Minimal ACP peer transcript: initialize -> session/new -> updates -> result."""

    def __init__(self, updates: list[dict[str, Any]]) -> None:
        self.stdin = _Stdin()
        self.stdout = io.StringIO("".join(json.dumps(m) + "\n" for m in updates))
        self.stderr = io.StringIO("")
        self.returncode: int | None = None
        self.terminate_called = False

    def start(self, command: list[str], **kwargs: Any) -> "ScriptedPeer":
        self.command = command
        return self

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        self.returncode = 0
        return 0

    def terminate(self) -> None:
        self.terminate_called = True
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = 0


def _agent_chunk(text: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": SESSION,
            "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": text}},
        },
    }


def _transcript(chunks: list[str]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [
        {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": 1}},
        {"jsonrpc": "2.0", "id": 2, "result": {"sessionId": SESSION}},
        {"jsonrpc": "2.0", "id": 3, "result": {}},
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION,
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": CALL,
                    "title": "Agent",
                    "kind": "other",
                    "status": "pending",
                    "rawInput": {
                        "description": f"harness-child:{NONCE}",
                        "subagent_type": "plan",
                        "prompt": "CHILD_PROMPT body",
                    },
                },
            },
        },
    ]
    messages.extend(_agent_chunk(text) for text in chunks)
    messages.append(
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": SESSION,
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": CALL,
                    "status": "completed",
                },
            },
        }
    )
    messages.append({"jsonrpc": "2.0", "id": 4, "result": {"stopReason": "end_turn"}})
    return messages


ENVELOPE = {
    "task_id": "probe-terminal-message-1",
    "contract_version": "harness/1.1",
    "batch": "BL-NATIVE-SUBAGENT-BRIDGES",
    "role": "planner",
    "repo": {"url": str(REPO), "ref": "ce249dc3c431e95a42603e6209158de1a1620f3f"},
    "l2_authorized": False,
    "contract": "probe contract, forty characters minimum for the schema check to pass",
    "deliverable": {
        "artifact": "docs/test-reports/planner-proposal-probe.json",
        "schema": ".claude/dispatch/planner-proposal.schema.json",
        "commit_to": None,
    },
}

PROTOCOL = {
    "kind": "acp-native-agent/v1",
    "command": ["kimi", "acp"],
    "request_delivery": "stdin",
    "response_format": "json",
}

def _worker_env(home: Path) -> dict[str, str]:
    return {
        "HARNESS_PROVIDER_LAUNCH_NONCE": NONCE,
        "HARNESS_PROVIDER_LAUNCH_ATTESTATION_SHA256": "b" * 64,
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "TMPDIR": str(home / "tmp"),
    }


def _run_bridge(worktree: Path, peer: ScriptedPeer, channel: str, role: str = "planner",
                native: str = "plan", persona: str = "planner-proposal") -> dict[str, Any]:
    envelope = json.loads(json.dumps(ENVELOPE))
    envelope["role"] = role
    # run_acp_native_agent binds subprocess.Popen as a default argument, so the
    # peer is injected through the driver's documented popen seam. Everything
    # else (prompt build, nonce proof, materialization) stays production code.
    real_driver = KIMI.run_acp_native_agent

    def injected(*args: Any, **kwargs: Any) -> dict[str, Any]:
        kwargs.setdefault("popen", peer.start)
        return real_driver(*args, **kwargs)

    with patch.object(BRIDGE, "run_acp_native_agent", injected):
        return BRIDGE.run_bridge(
            bridge_id="kimi-acp-native-agent",
            strategy="session-bridge-v1",
            protocol=PROTOCOL,
            persona=persona,
            native_agent_type=native,
            envelope=envelope,
            worktree=worktree,
            timeout_s=60,
            worker_env=_worker_env(worktree.parent / "worker-home"),
            worker_state_root=worktree / ".state",
            deliverable_channel=channel,
        )


class TerminalMessageChannel(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.worktree = Path(self.tmp.name) / "source"
        (self.worktree / "docs" / "test-reports").mkdir(parents=True)
        (Path(self.tmp.name) / "worker-home" / "tmp").mkdir(parents=True)
        (self.worktree / ".state").mkdir(parents=True)
        self.addCleanup(self.tmp.cleanup)

    @property
    def artifact(self) -> Path:
        return self.worktree / ENVELOPE["deliverable"]["artifact"]

    # --- happy path -----------------------------------------------------
    def test_materializes_relayed_text_and_binds_it_into_the_receipt(self) -> None:
        peer = ScriptedPeer(_transcript(['{"proposal_version": ', '"planner-proposal/1"}']))
        receipt = _run_bridge(self.worktree, peer, "terminal-message")

        self.assertEqual(receipt["terminal_status"], "completed")
        self.assertEqual(receipt["subagent_type"], "plan")
        body = self.artifact.read_bytes()
        self.assertEqual(body, b'{"proposal_version": "planner-proposal/1"}')
        self.assertEqual(receipt["artifact_sha256"], hashlib.sha256(body).hexdigest())
        self.assertEqual(receipt["nonce_sha256"], hashlib.sha256(NONCE.encode()).hexdigest())
        if os.name == "posix":
            self.assertEqual(self.artifact.stat().st_mode & 0o777, 0o600)
        blob = json.dumps(receipt)
        self.assertNotIn("proposal_version", blob)
        self.assertNotIn(NONCE, blob)
        self.assertNotIn(SESSION, blob)

    def test_file_channel_still_requires_the_child_to_write(self) -> None:
        peer = ScriptedPeer(_transcript(["a status line only"]))
        with self.assertRaises(BRIDGE.SessionBridgeError):
            _run_bridge(self.worktree, peer, "file", role="evaluator",
                        native="explore", persona="evaluator")
        self.assertFalse(self.artifact.exists())

    # --- fail-closed ----------------------------------------------------
    def test_empty_relay_fails_closed_and_leaves_no_artifact(self) -> None:
        peer = ScriptedPeer(_transcript(["   \n  "]))
        with self.assertRaises(BRIDGE.SessionBridgeError):
            _run_bridge(self.worktree, peer, "terminal-message")
        self.assertFalse(self.artifact.exists())

    def test_oversized_relay_fails_closed(self) -> None:
        peer = ScriptedPeer(_transcript(["x" * (1024 * 1024 + 1)]))
        with self.assertRaises(BRIDGE.SessionBridgeError):
            _run_bridge(self.worktree, peer, "terminal-message")
        self.assertFalse(self.artifact.exists())

    def test_unpublished_channel_is_refused_before_the_vendor_starts(self) -> None:
        peer = ScriptedPeer(_transcript(["ignored"]))
        with self.assertRaises(BRIDGE.SessionBridgeError):
            _run_bridge(self.worktree, peer, "stdout")
        self.assertIsNone(peer.returncode)  # peer never launched

    def test_symlinked_artifact_path_is_refused(self) -> None:
        outside = Path(self.tmp.name) / "outside.json"
        outside.write_text("{}", encoding="utf-8")
        self.artifact.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(outside, self.artifact)
        peer = ScriptedPeer(_transcript(["deliverable"]))
        with self.assertRaises(BRIDGE.SessionBridgeError):
            _run_bridge(self.worktree, peer, "terminal-message")
        self.assertEqual(outside.read_text(encoding="utf-8"), "{}")

    def test_preexisting_artifact_is_not_silently_overwritten_in_the_worktree(self) -> None:
        """Documents the driver-side exclusive-create boundary (see report OBS)."""
        self.artifact.write_text("baseline copy\n", encoding="utf-8")
        peer = ScriptedPeer(_transcript(["fresh deliverable"]))
        with self.assertRaises(BRIDGE.SessionBridgeError):
            _run_bridge(self.worktree, peer, "terminal-message")
        self.assertEqual(self.artifact.read_text(encoding="utf-8"), "baseline copy\n")


class ProviderArtifactOverwrite(unittest.TestCase):
    """D9: the commissioned artifact path is a legal overwrite point."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.baseline = self.root / "baseline"
        self.returned = self.root / "returned"
        self.staging = self.root / "staging"
        for tree in (self.baseline, self.returned, self.staging):
            (tree / "docs" / "test-reports").mkdir(parents=True)

    def _write(self, tree: Path, rel: str, body: str) -> None:
        (tree / rel).write_text(body, encoding="utf-8")

    def test_overwrite_is_accepted_and_counted(self) -> None:
        rel = "docs/test-reports/BL-PROBE-verdict.json"
        self._write(self.baseline, rel, '{"round": 1}\n')
        self._write(self.returned, rel, '{"round": 2}\n')
        staged, changed = PROVIDER._reconcile_returned_source(
            returned_root=self.returned, baseline_root=self.baseline,
            staging=self.staging, role="evaluator", artifact=rel,
        )
        self.assertEqual(changed, (rel,))
        self.assertEqual(staged.read_text(encoding="utf-8"), '{"round": 2}\n')

    def test_identical_overwrite_is_not_counted(self) -> None:
        rel = "docs/test-reports/BL-PROBE-verdict.json"
        self._write(self.baseline, rel, '{"round": 1}\n')
        self._write(self.returned, rel, '{"round": 1}\n')
        _, changed = PROVIDER._reconcile_returned_source(
            returned_root=self.returned, baseline_root=self.baseline,
            staging=self.staging, role="evaluator", artifact=rel,
        )
        self.assertEqual(changed, ())

    def test_read_only_role_source_change_outside_the_artifact_still_fails(self) -> None:
        """D9 legalizes only the artifact path; other deltas stay fail-closed."""
        rel = "docs/test-reports/BL-PROBE-verdict.json"
        self._write(self.baseline, rel, '{"round": 1}\n')
        self._write(self.returned, rel, '{"round": 2}\n')
        self._write(self.baseline, "README.md", "before\n")
        self._write(self.returned, "README.md", "after\n")
        with self.assertRaisesRegex(
            PROVIDER.ProviderError, "read-only bridge returned a source change"
        ):
            PROVIDER._reconcile_returned_source(
                returned_root=self.returned, baseline_root=self.baseline,
                staging=self.staging, role="evaluator", artifact=rel,
            )

    def test_missing_artifact_still_fails_closed(self) -> None:
        rel = "docs/test-reports/BL-PROBE-verdict.json"
        self._write(self.baseline, rel, '{"round": 1}\n')
        with self.assertRaises(PROVIDER.ProviderError):
            PROVIDER._reconcile_returned_source(
                returned_root=self.returned, baseline_root=self.baseline,
                staging=self.staging, role="evaluator", artifact=rel,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
