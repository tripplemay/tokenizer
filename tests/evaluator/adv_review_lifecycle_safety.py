#!/usr/bin/env python3
"""Adversarial re-verification probe for claim 2 (BL-NATIVE-SUBAGENT-BRIDGES).

Claim under test: the single ``test-lifecycle.py`` failure is a stale assertion
about the old rejection wording, and the security properties it guards
(fail-closed exit 2, no workroot/state creation, no Seatbelt path) still hold
at the locked SHA.

This probe does NOT reuse the failing test.  It re-creates the same fixture and
executes the assertions the failing test never reached (its string assertion
aborts the test method before them), plus adversarial variants the original
test does not cover.

Read-only with respect to product code; writes only into a temp dir.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DISPATCH = REPO / ".claude" / "dispatch"
SANDBOX = DISPATCH / "sandbox-profile.sh"

# Any of these appearing in stderr proves execution reached the historical
# Seatbelt scaffold (sandbox-profile.sh:606-629) rather than dying before it.
SEATBELT_STAGE_MARKERS = (
    "external same-session bridge 需要宿主文件系统隔离 provider",
    "external same-session bridge 需要受信任的 /usr/bin/sandbox-exec",
    "external bridge writable roots",
    "同会话 bridge runtime 子目录创建失败",
)


class ExternalSameSessionRejectionSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "project"
        self.repo.mkdir()
        run = lambda *a: subprocess.run(a, check=True, capture_output=True)
        run("git", "-C", str(self.repo), "init", "-q")
        run("git", "-C", str(self.repo), "config", "user.email", "fixture@example.invalid")
        run("git", "-C", str(self.repo), "config", "user.name", "fixture")
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        run("git", "-C", str(self.repo), "add", "README.md")
        run("git", "-C", str(self.repo), "commit", "-qm", "fixture")
        self.ref = subprocess.check_output(
            ["git", "-C", str(self.repo), "rev-parse", "HEAD"], text=True
        ).strip()

    def tearDown(self):
        self.temp.cleanup()

    def _registry(self, *, with_subagent: bool) -> Path:
        integration = {
            "id": "kimi",
            "tool": "kimi",
            "model_family": "kimi",
            "local_cli": {
                "adapter": "kimi",
                "sandbox": {"home_dir": str(self.root / "safe-kimi-home")},
                "timeout_s": 60,
            },
        }
        if with_subagent:
            integration["subagent"] = {"bridge": "kimi-acp-native-agent"}
        path = self.repo / ".agents-registry.json"
        path.write_text(
            json.dumps(
                {
                    "version": "tool-integrations/1",
                    "integrations": [integration],
                    "a2a_targets": [],
                }
            ),
            encoding="utf-8",
        )
        return path

    def _envelope(self) -> Path:
        path = self.root / "bridge-envelope.json"
        path.write_text(
            json.dumps(
                {
                    "task_id": "lifecycle-fixture",
                    "contract_version": "harness/1.1",
                    "batch": "BL-LIFECYCLE-FIXTURE",
                    "role": "evaluator",
                    "repo": {"url": str(self.repo), "ref": self.ref},
                    "l2_authorized": False,
                    "contract": "Deterministic fixture contract with enough detail for validation.",
                    "deliverable": {
                        "artifact": "docs/test-reports/BL-LIFECYCLE-FIXTURE-verdict.json",
                        "schema": ".claude/autonomous/verdict-artifact.schema.json",
                        "commit_to": None,
                    },
                }
            ),
            encoding="utf-8",
        )
        return path

    def _run(self, registry: Path, agent: str, suffix: str):
        workroot = self.root / f"work-{suffix}"
        state = self.root / f"state-{suffix}"
        result = subprocess.run(
            [
                "bash", str(SANDBOX),
                "--agent", agent,
                "--envelope", str(self._envelope()),
                "--registry", str(registry),
                "--workroot", str(workroot),
                "--state", str(state),
            ],
            cwd=self.repo,
            capture_output=True,
            text=True,
        )
        return result, workroot, state

    def _assert_safe_rejection(self, result, workroot, state):
        self.assertEqual(result.returncode, 2, f"expected fail-closed exit 2\n{result.stderr}")
        self.assertFalse(workroot.exists(), "workroot must not be created")
        self.assertFalse(state.exists(), "state must not be created")
        for marker in SEATBELT_STAGE_MARKERS:
            self.assertNotIn(marker, result.stderr, f"reached Seatbelt stage: {marker}")

    def test_registered_stale_kimi_bridge_target_is_rejected_before_runtime(self):
        """The exact scenario of the failing test, minus the wording assertion."""
        registry = self._registry(with_subagent=True)
        result, workroot, state = self._run(registry, "subagent--kimi--evaluator", "a")
        self._assert_safe_rejection(result, workroot, state)
        self.assertIn("does not launch here", result.stderr)

    def test_rejection_is_deterministic_across_repeats(self):
        registry = self._registry(with_subagent=True)
        for index in range(3):
            result, workroot, state = self._run(registry, "subagent--kimi--evaluator", f"r{index}")
            self._assert_safe_rejection(result, workroot, state)

    def test_unregistered_subagent_target_is_also_rejected_before_runtime(self):
        """Adversarial: the old wording's scenario (target absent) is still safe."""
        registry = self._registry(with_subagent=False)
        result, workroot, state = self._run(registry, "subagent--kimi--evaluator", "b")
        self._assert_safe_rejection(result, workroot, state)

    def test_unknown_tool_subagent_target_is_rejected_before_runtime(self):
        registry = self._registry(with_subagent=True)
        result, workroot, state = self._run(registry, "subagent--ghost--evaluator", "c")
        self._assert_safe_rejection(result, workroot, state)

    def test_seatbelt_scaffold_is_structurally_unreachable(self):
        """The legacy block shares the guard condition that dies earlier."""
        text = SANDBOX.read_text(encoding="utf-8")
        die_index = text.index("external same-session bridge does not launch here")
        scaffold_index = text.index("Historical, unreachable Seatbelt scaffold")
        mkdir_index = text.index('mkdir -p "$WORKROOT"')
        self.assertLess(die_index, mkdir_index, "die must precede workroot creation")
        self.assertLess(die_index, scaffold_index, "die must precede the Seatbelt scaffold")
        self.assertLess(die_index, text.index("/usr/bin/sandbox-exec"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
