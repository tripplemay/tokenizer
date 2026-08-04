#!/usr/bin/env python3
"""Independent Evaluator probe for BL-NATIVE-SUBAGENT-BRIDGES F003.

Written fresh by the reverify Evaluator. It deliberately does NOT reuse the
Generator's fixtures in .claude/dispatch/test-session-bridge*.py. Instead it
spawns a real ACP peer subprocess that speaks JSON-RPC over stdio, so the
driver is exercised end to end (Popen, env construction, stream parsing,
process-group reaping) rather than through a mocked ``popen``.

Covered F003 acceptance clauses:
  A. runner drives ACP initialize / session/new / session/prompt
  B. delegation prompt carries a single-use nonce
  C. accepted only on matching nonce + plan|coder|explore type + completion
  D. no user Kimi session wire / host KIMI_CODE_HOME / host credential access
  E. fail-closed on missing evidence, ACP error, permission request

Run: python3 scripts/test/f003_kimi_acp_bridge_independent.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TRANSPORTS = REPO / ".claude" / "dispatch" / "transports"
sys.path.insert(0, str(TRANSPORTS))

from session_bridge_kimi import KimiBridgeError, run_acp_native_agent  # noqa: E402

NONCE = "0123456789abcdef0123456789abcdef"

# A real ACP peer. ``mode`` selects the adversarial behaviour under test.
PEER = r'''
import json, os, sys, re

mode = os.environ.get("PEER_MODE", "happy")
report = os.environ.get("PEER_REPORT")

if report:
    home = os.environ.get("KIMI_CODE_HOME")
    listing = []
    if home and os.path.isdir(home):
        for root, dirs, files in os.walk(home):
            for name in files:
                listing.append(os.path.relpath(os.path.join(root, name), home))
    with open(report, "w", encoding="utf-8") as fh:
        json.dump({"env": dict(os.environ), "kimi_home": home,
                   "kimi_home_entries": listing}, fh)

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def note(update):
    send({"jsonrpc": "2.0", "method": "session/update",
          "params": {"sessionId": "sess-1", "update": update}})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method, ident = msg.get("method"), msg.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": ident, "result": {"protocolVersion": 1}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": ident, "result": {"sessionId": "sess-1"}})
    elif method == "session/set_config_option":
        send({"jsonrpc": "2.0", "id": ident, "result": {}})
    elif method == "session/prompt":
        text = msg["params"]["prompt"][0]["text"]
        found = re.search(r"harness-child:([0-9a-f]{32})", text)
        nonce = found.group(1) if found else "no-nonce"
        want = re.search(r"subagent_type must be (\w+)", text)
        stype = want.group(1) if want else "coder"

        if mode == "permission":
            # Reverse RPC: ACP asks the client to approve a tool.
            send({"jsonrpc": "2.0", "id": 9001,
                  "method": "session/request_permission",
                  "params": {"sessionId": "sess-1"}})
            continue
        if mode == "acp_error":
            send({"jsonrpc": "2.0", "id": ident,
                  "error": {"code": -32000, "message": "denied"}})
            continue

        if mode == "wrong_nonce":
            nonce = "ffffffffffffffffffffffffffffffff"
        if mode == "wrong_type":
            stype = "explore" if stype != "explore" else "plan"

        if mode != "no_agent_call":
            note({"sessionUpdate": "tool_call", "toolCallId": "call-1",
                  "title": "Agent"})
            note({"sessionUpdate": "tool_call_update", "toolCallId": "call-1",
                  "rawInput": {"description": "harness-child:" + nonce,
                               "subagent_type": stype}})
        if mode == "two_agents":
            note({"sessionUpdate": "tool_call", "toolCallId": "call-2",
                  "title": "Agent"})
            note({"sessionUpdate": "tool_call_update", "toolCallId": "call-2",
                  "rawInput": {"description": "harness-child:" + nonce,
                               "subagent_type": stype}})
            note({"sessionUpdate": "tool_call_update", "toolCallId": "call-2",
                  "status": "completed"})
        if mode not in ("no_completion", "no_agent_call"):
            note({"sessionUpdate": "tool_call_update", "toolCallId": "call-1",
                  "status": "completed"})
        # Root text must never reach a receipt.
        note({"sessionUpdate": "agent_message_chunk",
              "content": {"type": "text", "text": "SECRET_MODEL_TEXT"}})
        send({"jsonrpc": "2.0", "id": ident,
              "result": {"stopReason": "end_turn"}})
    else:
        send({"jsonrpc": "2.0", "id": ident, "result": {}})
'''


class F003BridgeProbe(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.peer = root / "acp_peer.py"
        self.peer.write_text(PEER, encoding="utf-8")
        self.cwd = root / "worktree"
        self.cwd.mkdir()
        self.state_root = root / "worker-state"
        self.state_root.mkdir()
        # A decoy host Kimi state the worker must never read.
        self.host_home = root / "host-kimi-home"
        (self.host_home / "credentials").mkdir(parents=True)
        (self.host_home / "credentials" / "kimi-code.json").write_text(
            json.dumps({"access_token": "HOST_TOKEN_MUST_NOT_LEAK"}), encoding="utf-8"
        )
        (self.host_home / "sessions").mkdir()
        (self.host_home / "sessions" / "wire.jsonl").write_text(
            '{"prompt":"HOST_WIRE_MUST_NOT_LEAK"}\n', encoding="utf-8"
        )
        self.addCleanup(self.tmp.cleanup)

    def worker_env(self, **extra: str) -> dict[str, str]:
        env = {
            "HOME": str(self.state_root),
            "TMPDIR": str(self.state_root),
            "PATH": "/usr/bin:/bin",
        }
        env.update(extra)
        return env

    def run_bridge(self, mode: str = "happy", stype: str = "coder",
                   report: Path | None = None, **kwargs):
        os.environ["PEER_MODE"] = mode
        if report is not None:
            os.environ["PEER_REPORT"] = str(report)
        else:
            os.environ.pop("PEER_REPORT", None)
        self.addCleanup(lambda: os.environ.pop("PEER_MODE", None))
        self.addCleanup(lambda: os.environ.pop("PEER_REPORT", None))
        env = dict(os.environ)
        # The peer subprocess needs PEER_MODE, which is not on the bridge
        # allowlist; inject it through a wrapper command instead of the env.
        wrapper = Path(self.tmp.name) / f"wrap_{mode}.py"
        wrapper.write_text(
            "import os,runpy,sys\n"
            f"os.environ['PEER_MODE']={mode!r}\n"
            + (f"os.environ['PEER_REPORT']={str(report)!r}\n" if report else "")
            + f"runpy.run_path({str(self.peer)!r}, run_name='__main__')\n",
            encoding="utf-8",
        )
        return run_acp_native_agent(
            command=[sys.executable, str(wrapper)],
            cwd=str(self.cwd),
            prompt=kwargs.pop("prompt", self.delegation_prompt(stype)),
            nonce=kwargs.pop("nonce", NONCE),
            subagent_type=stype,
            timeout_s=30,
            worker_env=kwargs.pop("worker_env", self.worker_env()),
            worker_state_root=kwargs.pop("worker_state_root", self.state_root),
            **kwargs,
        )

    @staticmethod
    def delegation_prompt(stype: str, nonce: str = NONCE) -> str:
        return (
            "You are the root of a Harness same-session bridge. Launch exactly one "
            f"native Agent tool call. Its description must be exactly harness-child:{nonce}. "
            f"Its subagent_type must be {stype}."
        )

    # ---- A + C: protocol drive and accepted proof -----------------------
    def test_happy_path_returns_nonce_bound_receipt_without_model_text(self):
        proof = self.run_bridge(mode="happy", stype="coder")
        self.assertEqual(proof["bridge_kind"], "acp-native-agent/v1")
        self.assertEqual(proof["terminal_status"], "completed")
        self.assertEqual(proof["subagent_type"], "coder")
        self.assertEqual(
            proof["nonce_sha256"], hashlib.sha256(NONCE.encode()).hexdigest()
        )
        self.assertEqual(
            proof["session_id_sha256"], hashlib.sha256(b"sess-1").hexdigest()
        )
        blob = json.dumps(proof)
        for leak in ("SECRET_MODEL_TEXT", "sess-1", NONCE, "call-1"):
            self.assertNotIn(leak, blob, f"receipt leaked {leak}")
        for field in ("session_id_sha256", "nonce_sha256", "child_call_id_sha256"):
            self.assertRegex(proof[field], r"^[0-9a-f]{64}$")

    def test_all_three_manifest_personas_are_accepted(self):
        for stype in ("plan", "coder", "explore"):
            with self.subTest(stype=stype):
                proof = self.run_bridge(mode="happy", stype=stype)
                self.assertEqual(proof["subagent_type"], stype)

    def test_unpublished_subagent_type_is_rejected(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="happy", stype="architect")

    # ---- C/E: fail-closed on weak evidence ------------------------------
    def test_nonce_mismatch_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="wrong_nonce")

    def test_type_mismatch_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="wrong_type")

    def test_missing_completion_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="no_completion")

    def test_absent_agent_call_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="no_agent_call")

    def test_more_than_one_agent_call_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="two_agents")

    def test_acp_error_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="acp_error")

    def test_reverse_permission_request_fails_closed(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="permission")

    def test_malformed_nonce_is_rejected_before_spawn(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(mode="happy", nonce="not-a-nonce")

    # ---- D/F: credential and host-state isolation -----------------------
    def test_worker_never_sees_host_kimi_home_credentials_or_wire(self):
        os.environ["KIMI_CODE_HOME"] = str(self.host_home)
        os.environ["HOST_ONLY_SECRET"] = "HOST_ENV_MUST_NOT_LEAK"
        self.addCleanup(lambda: os.environ.pop("KIMI_CODE_HOME", None))
        self.addCleanup(lambda: os.environ.pop("HOST_ONLY_SECRET", None))
        report = Path(self.tmp.name) / "peer-report.json"
        proof = self.run_bridge(mode="happy", stype="coder", report=report)
        self.assertEqual(proof["terminal_status"], "completed")

        observed = json.loads(report.read_text(encoding="utf-8"))
        child_home = observed["kimi_home"]
        self.assertIsNotNone(child_home)
        # The child's Kimi state must be a fresh private dir inside the
        # provider-owned worker state root, not the host's.
        self.assertNotEqual(
            Path(child_home).resolve(), self.host_home.resolve(),
            "worker reused the host KIMI_CODE_HOME",
        )
        self.assertTrue(
            str(Path(child_home).resolve()).startswith(
                str(self.state_root.resolve())
            ),
            f"child KIMI_CODE_HOME {child_home} escaped the worker state root",
        )
        self.assertEqual(
            observed["kimi_home_entries"], [],
            "worker Kimi state was not empty at launch",
        )
        env_blob = json.dumps(observed["env"])
        for leak in ("HOST_TOKEN_MUST_NOT_LEAK", "HOST_WIRE_MUST_NOT_LEAK",
                     "HOST_ENV_MUST_NOT_LEAK"):
            self.assertNotIn(leak, env_blob, f"worker env leaked {leak}")
        self.assertNotIn("HOST_ONLY_SECRET", observed["env"])

    def test_worker_env_outside_allowlist_is_rejected(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(
                worker_env=self.worker_env(AWS_SECRET_ACCESS_KEY="x"),
            )

    def test_missing_provider_worker_state_root_is_rejected(self):
        with self.assertRaises(KimiBridgeError):
            self.run_bridge(worker_state_root=None)

    def test_ephemeral_worker_state_is_removed_after_the_run(self):
        # Only the bridge-created Kimi state is asserted here. The peer is a
        # real interpreter whose HOME is this root, so unrelated runtime dirs
        # (macOS ``Library/``) are expected and are not bridge state.
        proof = self.run_bridge(mode="happy")
        self.assertEqual(proof["terminal_status"], "completed")
        leftover = [p.name for p in self.state_root.iterdir()
                    if p.name.startswith("kimi-code-")]
        self.assertEqual(leftover, [], "ephemeral Kimi state was left behind")

    # ---- B: single-use nonce in the delegation prompt --------------------
    def test_generated_root_prompt_binds_exactly_one_nonce(self):
        sys.path.insert(0, str(TRANSPORTS))
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "session_bridge_mod", TRANSPORTS / "session-bridge.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        envelope = {"role": "generator",
                    "deliverable": {"artifact": "out/handoff.json"}}
        prompt = module._native_root_prompt(
            envelope, "generator-restricted", NONCE, "coder"
        )
        self.assertEqual(len(re.findall(re.escape(NONCE), prompt)), 1)
        self.assertIn(f"harness-child:{NONCE}", prompt)
        self.assertIn("subagent_type must be coder", prompt)
        self.assertIn("launch exactly one native Agent tool call", prompt)
        self.assertEqual(
            module.PERSONAS,
            {"planner": "planner-proposal",
             "generator": "generator-restricted",
             "evaluator": "evaluator"},
        )
        self.assertEqual(module.NATIVE_AGENT_TYPES, {"plan", "coder", "explore"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
