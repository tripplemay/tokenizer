#!/usr/bin/env python3
"""Regression fixtures for pending-gate Ed25519 verification."""

import base64
import copy
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


HERE = pathlib.Path(__file__).resolve().parent
VALIDATOR = HERE / "validate-pending-gate.sh"


def find_openssl():
    for candidate in (
        os.environ.get("HARNESS_OPENSSL"),
        "/opt/homebrew/bin/openssl",
        "/opt/homebrew/opt/openssl@3/bin/openssl",
        "/usr/local/bin/openssl",
        "/usr/local/opt/openssl@3/bin/openssl",
        "openssl",
    ):
        if not candidate:
            continue
        try:
            probe = subprocess.run(
                [candidate, "list", "-public-key-algorithms"],
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            continue
        if probe.returncode == 0 and "ED25519" in probe.stdout.upper():
            return candidate
    raise unittest.SkipTest("test requires an Ed25519-capable OpenSSL 3")


def canonical(decision):
    payload = {key: value for key, value in decision.items() if key != "sig"}
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


class PendingGateGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pending-gate-test-")
        self.root = pathlib.Path(self.tmp.name)
        self.openssl = find_openssl()
        self.private_key = self.root / "console.key"
        self.public_key = self.root / "console.pub"
        subprocess.run(
            [self.openssl, "genpkey", "-algorithm", "Ed25519", "-out", self.private_key],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [self.openssl, "pkey", "-in", self.private_key, "-pubout", "-out", self.public_key],
            check=True,
            capture_output=True,
        )
        self.validator = self.root / "validate-pending-gate.sh"
        self.validator.write_bytes(VALIDATOR.read_bytes())
        self.validator.chmod(0o755)
        self.public_key.replace(self.root / "console.pub")

    def tearDown(self):
        self.tmp.cleanup()

    def signed_progress(self):
        decision = {
            "gate_id": "BL-TEST-verifying-done-w1",
            "action": "approve",
            "by": "human@example.invalid",
            "at": "2026-07-29T10:00:00Z",
            "scope": {"once": True},
        }
        payload = self.root / "payload.json"
        signature = self.root / "signature.bin"
        payload.write_bytes(canonical(decision))
        subprocess.run(
            [
                self.openssl,
                "pkeyutl",
                "-sign",
                "-inkey",
                self.private_key,
                "-rawin",
                "-in",
                payload,
                "-out",
                signature,
            ],
            check=True,
            capture_output=True,
        )
        decision["sig"] = base64.b64encode(signature.read_bytes()).decode("ascii")
        return {
            "status": "verifying",
            "pending_gate": {
                "id": decision["gate_id"],
                "kind": "phase_advance",
                "raised_at": "2026-07-29T09:00:00Z",
                "raised_by": "verify",
                "batch": "BL-TEST",
                "from_status": "verifying",
                "to_status": "done",
                "detail": "All acceptance checks passed.",
                "evidence": [],
                "decision": decision,
            },
        }

    def run_guard(self, progress):
        path = self.root / "progress.json"
        path.write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")
        env = os.environ.copy()
        env["HARNESS_OPENSSL"] = self.openssl
        return subprocess.run(
            ["bash", self.validator, "guard", path],
            env=env,
            capture_output=True,
            text=True,
        )

    def test_valid_signature_uses_ed25519_capable_override(self):
        result = self.run_guard(self.signed_progress())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("签名有效", result.stdout)

    def test_tampered_signed_field_is_rejected(self):
        progress = self.signed_progress()
        progress["pending_gate"]["decision"]["scope"]["once"] = False
        result = self.run_guard(progress)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("签名无效", result.stdout)

    def test_consumed_gate_does_not_require_crypto(self):
        result = self.run_guard({"status": "done", "pending_gate": None})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("闸门已清空", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
